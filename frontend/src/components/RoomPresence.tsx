
import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import ConversationFeed, { type ConversationMessage } from "./ConversationFeed";
import StatusLine from "./StatusLine";
import { getLanguage } from "../languages";

type RoomSession = {
    roomCode: string;
    participantId: string;
    participantToken: string;
    displayName: string;
    spokenLanguage: string;
    preferredLanguage: string;
};

type Participant = {
    id: string;
    displayName: string;
    spokenLanguage: string;
    preferredLanguage: string;
    isMuted: boolean;
    connected: boolean;
};

type RoomAudioMetadata = {
    type: string;
    version?: number;
    roomCode: string;
    turnId: string;
    speakerId: string;
    speakerName?: string;
    targetLanguage: string;
    chunkIndex: number;
    providerChunkIndex?: number;
    voiceId?: string;
    sampleRate?: number;
    channels?: number;
    encoding?: string;
};

type BufferedAudioChunk = {
    pcm: ArrayBuffer;
    sampleRate: number;
};

type TurnAudioBuffer = {
    nextChunkIndex: number;
    chunks: Map<number, BufferedAudioChunk>;
    complete: boolean;
};

type Props = {
    roomSession: RoomSession;
    playbackContext?: AudioContext | null;
    initialMicStream?: MediaStream | null;
};

type PendingSttStart = {
    resolve: () => void;
    reject: (error: Error) => void;
};

const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// --------------------------------------------------
// PARTICIPANT HELPERS
// --------------------------------------------------

function findParticipants(
    value: unknown,
    depth = 0
): unknown[] | null {
    if (!value || typeof value !== "object" || depth > 6) {
        return null;
    }

    if (Array.isArray(value)) {
        return null;
    }

    const object = value as Record<string, unknown>;

    if (Array.isArray(object.participants)) {
        return object.participants;
    }

    for (const nested of Object.values(object)) {
        const result = findParticipants(nested, depth + 1);

        if (result) {
            return result;
        }
    }

    return null;
}

function normalizeParticipants(raw: unknown[]): Participant[] {
    return raw.flatMap((item): Participant[] => {
        if (!item || typeof item !== "object") {
            return [];
        }

        const p = item as Record<string, unknown>;
        const id = p.id ?? p.participantId;

        if (typeof id !== "string") {
            return [];
        }

        return [{
            id,
            displayName: String(p.displayName ?? "Participant"),
            spokenLanguage: String(p.spokenLanguage ?? ""),
            preferredLanguage: String(p.preferredLanguage ?? ""),
            isMuted: p.isMuted === true,
            connected: p.connected === true,
        }];
    });
}

// ==================================================
// ROOM PRESENCE COMPONENT
// ==================================================

export default function RoomPresence({
    roomSession,
    playbackContext: initialPlaybackContext,
    initialMicStream,
}: Props) {

    // --------------------------------------------------
    // STATE
    // --------------------------------------------------

    const [participants, setParticipants] =
        useState<Participant[]>([]);

    const [connectionStatus, setConnectionStatus] =
        useState("Connecting...");

    const [error, setError] = useState("");

    // Microphone & mute state (Phase 3)
    const [isStarting, setIsStarting] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const isMutedRef = useRef(false);
    const isEchoSuppressedRef = useRef(false);

    // Active speaker & status states (Phase 3)
    const [activeSpeaker, setActiveSpeaker] = useState<{
        id: string;
        displayName: string;
    } | null>(null);
    const speakerActivityTimerRef = useRef<number | null>(null);

    const [isProcessingTranslation, setIsProcessingTranslation] =
        useState(false);
    const [micError, setMicError] = useState<string | null>(null);

    // Room conversation messages (Phase 2)
    const [messages, setMessages] =
        useState<ConversationMessage[]>([]);

    const [playingTurnId, setPlayingTurnId] =
        useState<string | null>(null);

    // --------------------------------------------------
    // REFERENCES
    // --------------------------------------------------

    const wsRef = useRef<WebSocket | null>(null);

    // Microphone.
    const micStreamRef = useRef<MediaStream | null>(null);

    const micContextRef = useRef<AudioContext | null>(null);

    const micSourceRef =
        useRef<MediaStreamAudioSourceNode | null>(null);

    const micProcessorRef =
        useRef<AudioWorkletNode | null>(null);

    const micGainRef = useRef<GainNode | null>(null);

    // STT.
    const audioReadyRef = useRef(false);

    const pendingSttStartRef =
        useRef<PendingSttStart | null>(null);

    const sttStartTimeoutRef = useRef<number | null>(null);

    // TTS playback.
    const playbackContextRef = useRef<AudioContext | null>(
        initialPlaybackContext || null
    );

    useEffect(() => {
        if (initialPlaybackContext) {
            playbackContextRef.current = initialPlaybackContext;
        }
    }, [initialPlaybackContext]);

    const nextPlaybackTimeRef = useRef(0);

    // One audio buffer per speech turn.
    const turnAudioBuffersRef = useRef(
        new Map<string, TurnAudioBuffer>()
    );

    // --------------------------------------------------
    // MICROPHONE CLEANUP
    // --------------------------------------------------

    const stopMicrophone = useCallback(async () => {
        audioReadyRef.current = false;

        micSourceRef.current?.disconnect();
        micSourceRef.current = null;

        micProcessorRef.current?.disconnect();
        micProcessorRef.current = null;

        micGainRef.current?.disconnect();
        micGainRef.current = null;

        micStreamRef.current
            ?.getTracks()
            .forEach(track => track.stop());

        micStreamRef.current = null;

        const context = micContextRef.current;
        micContextRef.current = null;

        if (context && context.state !== "closed") {
            await context.close();
        }
    }, []);

    // --------------------------------------------------
    // MICROPHONE INITIALIZATION
    // --------------------------------------------------

    const startMicrophone = useCallback(async () => {
        try {
            // 1. Get or reuse microphone stream.
            let stream = micStreamRef.current;
            if (!stream || !stream.active) {
                if (initialMicStream && initialMicStream.active) {
                    stream = initialMicStream;
                } else if (navigator.mediaDevices?.getUserMedia) {
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                        video: false,
                    });
                } else {
                    throw new Error("Microphone access is unavailable.");
                }
            }

            micStreamRef.current = stream;

            // 2. Create 16 kHz audio context.
            const context = new AudioContext({
                sampleRate: 16000,
            });

            micContextRef.current = context;

            await context.resume();

            if (context.sampleRate !== 16000) {
                throw new Error(
                    `Expected 16000 Hz audio, got ${context.sampleRate} Hz`
                );
            }

            // 3. Load PCM conversion worklet.
            await context.audioWorklet.addModule("/pcm-worklet.js");

            const source = context.createMediaStreamSource(stream);
            micSourceRef.current = source;

            // 4. Create PCM processor.
            const processor = new AudioWorkletNode(
                context,
                "pcm16-processor",
                {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [1],
                }
            );

            micProcessorRef.current = processor;

            // 5. Keep audio graph alive without microphone feedback.
            const gain = context.createGain();
            gain.gain.value = 0;

            micGainRef.current = gain;

            // 6. Forward microphone PCM to the room WebSocket (with Echo Prevention).
            processor.port.onmessage = (
                event: MessageEvent<ArrayBuffer>
            ) => {
                const socket = wsRef.current;

                if (
                    !audioReadyRef.current ||
                    isMutedRef.current ||
                    isEchoSuppressedRef.current ||
                    socket?.readyState !== WebSocket.OPEN ||
                    socket.bufferedAmount >= 64 * 1024
                ) {
                    return;
                }

                if (event.data.byteLength !== 1024) {
                    console.warn(
                        "Unexpected PCM frame size:",
                        event.data.byteLength
                    );

                    return;
                }

                socket.send(event.data);
            };

            // 7. Connect audio graph.
            source.connect(processor);
            processor.connect(gain);
            gain.connect(context.destination);

        } catch (err) {
            await stopMicrophone();
            throw err;
        }
    }, [stopMicrophone, initialMicStream]);

    // --------------------------------------------------
    // AUDIO SESSION INITIALIZATION (MEET STYLE)
    // --------------------------------------------------

    const startAudioSession = useCallback(async () => {
        const socket = wsRef.current;

        if (
            socket?.readyState !== WebSocket.OPEN ||
            isStarting ||
            isMutedRef.current
        ) {
            return;
        }

        setIsStarting(true);
        setMicError(null);

        try {
            const readyPromise = new Promise<void>((resolve, reject) => {
                pendingSttStartRef.current = {
                    resolve,
                    reject,
                };

                sttStartTimeoutRef.current = window.setTimeout(() => {
                    pendingSttStartRef.current = null;
                    sttStartTimeoutRef.current = null;

                    reject(
                        new Error(
                            "Timed out waiting for speech service."
                        )
                    );
                }, 15000);
            });

            socket.send(JSON.stringify({
                type: "start_audio",
            }));

            await readyPromise;
            await startMicrophone();

        } catch (err) {
            console.error("Microphone session failed:", err);
            setMicError("Mic blocked. Check your browser permission.");

            const currentSocket = wsRef.current;
            if (currentSocket?.readyState === WebSocket.OPEN) {
                currentSocket.send(JSON.stringify({
                    type: "stop_audio",
                }));
            }

            await stopMicrophone();

        } finally {
            setIsStarting(false);
        }
    }, [isStarting, startMicrophone, stopMicrophone]);

    // --------------------------------------------------
    // MUTE / UNMUTE (MEET STYLE - STRICT BOOLEAN)
    // --------------------------------------------------

    const toggleMute = useCallback(async (forcedState?: boolean) => {
        const socket = wsRef.current;

        if (socket?.readyState !== WebSocket.OPEN) {
            return;
        }

        // Fix isMuted type bug: GUARANTEE primitive boolean
        const nextMuted: boolean =
            typeof forcedState === "boolean"
                ? forcedState
                : Boolean(!isMutedRef.current);

        isMutedRef.current = nextMuted;
        setIsMuted(nextMuted);

        if (nextMuted) {
            audioReadyRef.current = false;
        } else {
            if (!audioReadyRef.current) {
                void startAudioSession();
            }
        }

        socket.send(JSON.stringify({
            type: "set_mute",
            isMuted: nextMuted === true,
        }));
    }, [startAudioSession]);

    // ==================================================
    // TTS AUDIO PLAYBACK
    // ==================================================

    // --------------------------------------------------
    // 1. PLAY ONE PCM CHUNK
    // --------------------------------------------------

    const schedulePcmChunk = useCallback((
        pcm: ArrayBuffer,
        sampleRate: number,
        turnId?: string
    ) => {
        const context = playbackContextRef.current;

        if (!context || context.state !== "running") {
            return;
        }

        if (
            pcm.byteLength === 0 ||
            pcm.byteLength % 2 !== 0
        ) {
            throw new Error("Invalid PCM16 audio data.");
        }

        // Convert signed Int16 PCM into Float32.
        const sampleCount = pcm.byteLength / 2;

        const view = new DataView(pcm);
        const samples = new Float32Array(sampleCount);

        for (let i = 0; i < sampleCount; i++) {
            samples[i] = view.getInt16(i * 2, true) / 32768;
        }

        const audioBuffer = context.createBuffer(
            1,
            sampleCount,
            sampleRate
        );

        audioBuffer.copyToChannel(samples, 0);

        const source = context.createBufferSource();

        source.buffer = audioBuffer;
        source.connect(context.destination);

        // Schedule sequentially to avoid overlapping chunks.
        const startAt = Math.max(
            nextPlaybackTimeRef.current,
            context.currentTime + 0.06
        );

        source.start(startAt);

        nextPlaybackTimeRef.current =
            startAt + audioBuffer.duration;

        if (turnId) {
            // Echo prevention: pause mic capture while translated audio is playing
            isEchoSuppressedRef.current = true;
            setPlayingTurnId(turnId);

            source.onended = () => {
                const now = playbackContextRef.current?.currentTime ?? 0;
                if (now >= nextPlaybackTimeRef.current - 0.08) {
                    isEchoSuppressedRef.current = false;
                    setPlayingTurnId(current =>
                        current === turnId ? null : current
                    );
                }
            };
        }
    }, []);

    // --------------------------------------------------
    // 2. DRAIN TURN BUFFER IN ORDER
    // --------------------------------------------------

    const drainTurnBuffer = useCallback((turnId: string) => {
        const turn = turnAudioBuffersRef.current.get(turnId);
        const context = playbackContextRef.current;

        if (
            !turn ||
            !context ||
            context.state !== "running"
        ) {
            return;
        }

        while (turn.chunks.has(turn.nextChunkIndex)) {
            const chunk = turn.chunks.get(turn.nextChunkIndex);

            if (!chunk) {
                break;
            }

            turn.chunks.delete(turn.nextChunkIndex);

            try {
                schedulePcmChunk(
                    chunk.pcm,
                    chunk.sampleRate,
                    turnId
                );

            } catch (err) {
                console.error("PCM playback error:", err);

                setError(
                    err instanceof Error
                        ? err.message
                        : "Audio playback failed."
                );
                break;
            }

            turn.nextChunkIndex++;
        }

        // Release completed turn buffers.
        if (turn.complete && turn.chunks.size === 0) {
            turnAudioBuffersRef.current.delete(turnId);
        }
    }, [schedulePcmChunk]);

    // --------------------------------------------------
    // 3. DECODE ROOM BINARY AUDIO ENVELOPE
    // --------------------------------------------------

    const processRoomAudioPacket = useCallback((
        data: ArrayBuffer
    ) => {
        try {
            if (data.byteLength < 5) {
                throw new Error("Audio packet is too small.");
            }

            const view = new DataView(data);

            // First 4 bytes: big-endian JSON header length.
            const headerLength = view.getUint32(0, false);

            if (
                headerLength === 0 ||
                headerLength > 64 * 1024 ||
                headerLength > data.byteLength - 4
            ) {
                throw new Error(
                    "Invalid audio packet header length."
                );
            }

            // Extract metadata JSON.
            const headerBytes = new Uint8Array(
                data,
                4,
                headerLength
            );

            const headerText = new TextDecoder().decode(headerBytes);

            const metadata = JSON.parse(
                headerText
            ) as RoomAudioMetadata;

            // Only accept the expected room audio packet type.
            if (metadata.type !== "room_audio_chunk") {
                return;
            }

            // Validate current room.
            if (metadata.roomCode !== roomSession.roomCode) {
                return;
            }

            // Only play audio intended for this listener's language.
            if (
                metadata.targetLanguage !==
                roomSession.preferredLanguage
            ) {
                return;
            }

            // Never play the speaker's own voice.
            if (metadata.speakerId === roomSession.participantId) {
                return;
            }

            if (
                !metadata.turnId ||
                !Number.isInteger(metadata.chunkIndex) ||
                metadata.chunkIndex < 0
            ) {
                throw new Error("Invalid audio chunk metadata.");
            }

            if (
                metadata.channels !== undefined &&
                metadata.channels !== 1
            ) {
                throw new Error("Unsupported audio channel count.");
            }

            if (
                metadata.encoding &&
                metadata.encoding !== "pcm_s16le"
            ) {
                throw new Error("Unsupported audio encoding.");
            }

            const sampleRate = metadata.sampleRate ?? 48000;

            if (
                !Number.isFinite(sampleRate) ||
                sampleRate <= 0
            ) {
                throw new Error("Invalid audio sample rate.");
            }

            // Remaining bytes are PCM16 audio.
            const pcmStart = 4 + headerLength;
            const pcm = data.slice(pcmStart);

            if (
                pcm.byteLength === 0 ||
                pcm.byteLength % 2 !== 0
            ) {
                throw new Error("Invalid PCM audio chunk.");
            }

            // Get or create the buffer for this speech turn.
            let turn = turnAudioBuffersRef.current.get(
                metadata.turnId
            );

            if (!turn) {
                turn = {
                    // Chunk indexes are established by the first
                    // packet received for this turn.
                    nextChunkIndex: metadata.chunkIndex,
                    chunks: new Map(),
                    complete: false,
                };

                turnAudioBuffersRef.current.set(
                    metadata.turnId,
                    turn
                );
            }

            // Ignore duplicate or previously played chunks.
            if (
                metadata.chunkIndex < turn.nextChunkIndex ||
                turn.chunks.has(metadata.chunkIndex)
            ) {
                return;
            }

            turn.chunks.set(metadata.chunkIndex, {
                pcm,
                sampleRate,
            });

            // This plays immediately when audio has been enabled.
            // Otherwise, the data remains buffered.
            drainTurnBuffer(metadata.turnId);

        } catch (err) {
            console.error("Room audio decoding failed:", err);
        }
    }, [
        roomSession.roomCode,
        roomSession.participantId,
        roomSession.preferredLanguage,
        drainTurnBuffer,
    ]);

    // ==================================================
    // ROOM WEBSOCKET AND PRESENCE
    // ==================================================

    useEffect(() => {
        let disposed = false;
        let ws: WebSocket | null = null;

        // --------------------------------------------------
        // Clear pending STT startup.
        // --------------------------------------------------

        const clearPendingStart = (reason: string) => {
            if (sttStartTimeoutRef.current !== null) {
                window.clearTimeout(sttStartTimeoutRef.current);
                sttStartTimeoutRef.current = null;
            }

            const pending = pendingSttStartRef.current;
            pendingSttStartRef.current = null;

            pending?.reject(new Error(reason));
        };

        // --------------------------------------------------
        // Refresh participant roster.
        // --------------------------------------------------

        const refreshRoster = async () => {
            try {
                const response = await fetch(
                    `${API_BASE_URL}/api/rooms/${roomSession.roomCode}`
                );

                if (!response.ok) {
                    throw new Error(
                        `Room lookup failed (${response.status})`
                    );
                }

                const data: unknown = await response.json();

                const rawParticipants = findParticipants(data);

                if (!rawParticipants) {
                    throw new Error(
                        "Room response did not contain a participant list."
                    );
                }

                if (!disposed) {
                    const normalized =
                        normalizeParticipants(rawParticipants);

                    setParticipants(normalized);

                    const selfParticipant = normalized.find(
                        participant =>
                            participant.id === roomSession.participantId
                    );

                    if (selfParticipant) {
                        const serverMuted = selfParticipant.isMuted === true;
                        isMutedRef.current = serverMuted;
                        setIsMuted(serverMuted);
                    }

                    setError("");
                }

            } catch (err) {
                if (!disposed) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Could not load participants."
                    );
                }
            }
        };

        // --------------------------------------------------
        // Connect to room WebSocket.
        // --------------------------------------------------

        const connect = () => {
            const backendUrl = new URL(API_BASE_URL);

            const protocol =
                backendUrl.protocol === "https:" ? "wss:" : "ws:";

            const wsUrl =
                `${protocol}//${backendUrl.host}/ws/room`;

            ws = new WebSocket(wsUrl);

            ws.binaryType = "arraybuffer";

            wsRef.current = ws;

            // ----------------------------------------------
            // Socket opened.
            // ----------------------------------------------

            ws.onopen = () => {
                if (disposed) return;

                setConnectionStatus("Authenticating...");

                // Authentication must be the first message.
                ws?.send(JSON.stringify({
                    type: "auth",
                    roomCode: roomSession.roomCode,
                    participantId: roomSession.participantId,
                    token: roomSession.participantToken,
                }));
            };

            // ----------------------------------------------
            // Incoming messages.
            // ----------------------------------------------

            ws.onmessage = (event: MessageEvent) => {

                // Binary packets contain translated PCM audio.
                if (event.data instanceof ArrayBuffer) {
                    processRoomAudioPacket(event.data);
                    return;
                }

                let message: any;

                try {
                    message = JSON.parse(event.data);

                } catch {
                    console.error(
                        "Invalid room WebSocket message:",
                        event.data
                    );

                    return;
                }

                console.log("[Room WS]", message);

                switch (message.type) {

                    // --------------------------------------
                    // Room authenticated.
                    // --------------------------------------

                    case "room_joined": {
                        setConnectionStatus("Connected");
                        void refreshRoster();
                        if (!isMutedRef.current) {
                            void startAudioSession();
                        }
                        break;
                    }

                    // --------------------------------------
                    // Participant presence changed.
                    // --------------------------------------

                    case "room_updated": {
                        void refreshRoster();
                        break;
                    }

                    // --------------------------------------
                    // Speaker activity (speech detected).
                    // --------------------------------------

                    case "speaker_activity": {
                        const speaker = message.speaker ?? {};
                        if (speaker.id) {
                            setActiveSpeaker({
                                id: speaker.id,
                                displayName:
                                    speaker.displayName || "Participant",
                            });

                            if (speakerActivityTimerRef.current !== null) {
                                window.clearTimeout(
                                    speakerActivityTimerRef.current
                                );
                            }

                            speakerActivityTimerRef.current =
                                window.setTimeout(() => {
                                    setActiveSpeaker(current =>
                                        current?.id === speaker.id
                                            ? null
                                            : current
                                    );
                                }, 3000);
                        }
                        break;
                    }

                    // --------------------------------------
                    // Prisma STT is ready.
                    // --------------------------------------

                    case "stt_ready": {
                        if (sttStartTimeoutRef.current !== null) {
                            window.clearTimeout(
                                sttStartTimeoutRef.current
                            );

                            sttStartTimeoutRef.current = null;
                        }

                        audioReadyRef.current = true;

                        const pending = pendingSttStartRef.current;
                        pendingSttStartRef.current = null;

                        pending?.resolve();

                        break;
                    }

                    // --------------------------------------
                    // Transcript received from room speaker.
                    // --------------------------------------

                    case "speaker_transcript": {
                        setActiveSpeaker(null);
                        setIsProcessingTranslation(true);

                        const speaker = message.speaker ?? {};
                        const transcript = message.transcript ?? {};

                        if (typeof transcript.text !== "string") {
                            break;
                        }

                        const isSelf = speaker.id === roomSession.participantId;
                        const msgId = String(
                            transcript.segmentId ??
                            `${speaker.id ?? "speaker"}-${Date.now()}`
                        );

                        setMessages(prev => {
                            const existingIndex = prev.findIndex(m => m.id === msgId);
                            if (existingIndex >= 0) {
                                const updated = [...prev];
                                updated[existingIndex] = {
                                    ...updated[existingIndex],
                                    originalText: transcript.text,
                                    latencyMs: transcript.latencyMs ?? updated[existingIndex].latencyMs,
                                };
                                return updated;
                            }

                            const newMessage: ConversationMessage = {
                                id: msgId,
                                speakerId: speaker.id || "speaker",
                                speakerName: speaker.displayName || "Participant",
                                sourceLanguage:
                                    speaker.spokenLanguage ||
                                    transcript.detectedLanguage ||
                                    roomSession.spokenLanguage,
                                targetLanguage: isSelf
                                    ? undefined
                                    : roomSession.preferredLanguage,
                                isSelf,
                                originalText: transcript.text,
                                translatedText: isSelf ? undefined : undefined,
                                isTranslating: !isSelf,
                                timestamp: Date.now(),
                                latencyMs: transcript.latencyMs,
                            };

                            return [...prev, newMessage].slice(-50);
                        });

                        break;
                    }

                    // --------------------------------------
                    // Voice turn started (translation starting).
                    // --------------------------------------

                    case "voice_turn_started": {
                        const turnId = message.turnId;
                        const speakerId = message.speaker?.id;
                        const originalText = message.originalText;

                        if (turnId) {
                            setMessages(prev => {
                                const idx = prev.findLastIndex(
                                    m =>
                                        (!m.turnId && m.speakerId === speakerId) ||
                                        (originalText && m.originalText === originalText)
                                );
                                if (idx >= 0) {
                                    const updated = [...prev];
                                    updated[idx] = {
                                        ...updated[idx],
                                        turnId,
                                    };
                                    return updated;
                                }
                                return prev;
                            });
                        }

                        break;
                    }

                    // --------------------------------------
                    // Translation received.
                    // --------------------------------------

                    case "translation": {
                        setIsProcessingTranslation(false);
                        const turnId = message.turnId;
                        const speakerId = message.speaker?.id;
                        const originalText = message.originalText;
                        const translatedText = message.translatedText;

                        if (typeof translatedText === "string") {
                            setMessages(prev => {
                                let idx = -1;
                                if (turnId) {
                                    idx = prev.findLastIndex(m => m.turnId === turnId);
                                }
                                if (idx === -1 && originalText) {
                                    idx = prev.findLastIndex(
                                        m =>
                                            m.originalText === originalText &&
                                            (!speakerId || m.speakerId === speakerId)
                                    );
                                }
                                if (idx === -1 && speakerId) {
                                    idx = prev.findLastIndex(
                                        m =>
                                            m.speakerId === speakerId &&
                                            !m.translatedText
                                    );
                                }

                                if (idx >= 0) {
                                    const updated = [...prev];
                                    updated[idx] = {
                                        ...updated[idx],
                                        turnId: turnId || updated[idx].turnId,
                                        translatedText,
                                        isTranslating: false,
                                        latencyMs:
                                            typeof message.latencyMs === "number"
                                                ? message.latencyMs
                                                : updated[idx].latencyMs,
                                    };
                                    return updated;
                                }

                                const newMsg: ConversationMessage = {
                                    id: turnId || `turn-${Date.now()}`,
                                    turnId,
                                    speakerId: speakerId || "speaker",
                                    speakerName:
                                        message.speaker?.displayName ||
                                        "Participant",
                                    sourceLanguage: message.sourceLanguage || "",
                                    targetLanguage:
                                        message.targetLanguage ||
                                        roomSession.preferredLanguage,
                                    isSelf: speakerId === roomSession.participantId,
                                    originalText: originalText || "",
                                    translatedText,
                                    isTranslating: false,
                                    timestamp: Date.now(),
                                    latencyMs: message.latencyMs,
                                };
                                return [...prev, newMsg].slice(-50);
                            });
                        }

                        break;
                    }

                    // --------------------------------------
                    // TTS completed for a language group.
                    // --------------------------------------

                    case "room_tts_complete": {
                        const turnId = message.turnId;

                        if (typeof turnId === "string") {
                            const turn =
                                turnAudioBuffersRef.current.get(turnId);

                            if (turn) {
                                turn.complete = true;

                                if (turn.chunks.size === 0) {
                                    turnAudioBuffersRef.current.delete(
                                        turnId
                                    );
                                }
                            }
                        }

                        break;
                    }

                    // --------------------------------------
                    // STT or room errors (sanitized for user).
                    // --------------------------------------

                    case "stt_error": {
                        const messageText = message.message || "Microphone service error.";
                        audioReadyRef.current = false;
                        clearPendingStart(messageText);
                        setMicError("Mic service unavailable. Try again.");
                        break;
                    }

                    case "error":
                    case "room_error":
                    case "auth_error": {
                        const messageText = String(message.message || "");
                        audioReadyRef.current = false;
                        clearPendingStart(messageText);

                        if (messageText.toLowerCase().includes("mute")) {
                            // Handled silently
                        } else if (
                            message.type === "auth_error" ||
                            messageText.toLowerCase().includes("auth") ||
                            messageText.toLowerCase().includes("token")
                        ) {
                            setError("Session expired. Please rejoin.");
                            setConnectionStatus("Connection error");
                        } else {
                            setError("Connection error. Reconnecting…");
                        }

                        break;
                    }

                    default:
                        break;
                }
            };

            // ----------------------------------------------
            // Socket error.
            // ----------------------------------------------

            ws.onerror = () => {
                if (!disposed) {
                    setError(
                        "Could not connect to the room WebSocket."
                    );

                    setConnectionStatus("Connection error");
                }
            };

            // ----------------------------------------------
            // Socket closed.
            // ----------------------------------------------

            ws.onclose = () => {
                if (wsRef.current === ws) {
                    wsRef.current = null;
                }

                audioReadyRef.current = false;

                clearPendingStart("Room connection closed.");

                void stopMicrophone();

                if (!disposed) {
                    setConnectionStatus("Disconnected");
                }
            };
        };

        try {
            connect();

        } catch (err) {
            setConnectionStatus("Connection error");

            setError(
                err instanceof Error
                    ? err.message
                    : "WebSocket failed."
            );
        }

        // --------------------------------------------------
        // Cleanup.
        // --------------------------------------------------

        return () => {
            disposed = true;

            audioReadyRef.current = false;

            clearPendingStart("Room view unmounted.");

            if (wsRef.current === ws) {
                wsRef.current = null;
            }

            if (ws && ws.readyState < WebSocket.CLOSING) {
                ws.close(1000, "Room view unmounted");
            }

            void stopMicrophone();

            // Clear unfinished audio buffers.
            turnAudioBuffersRef.current.clear();

            // Close playback context.
            const playbackContext =
                playbackContextRef.current;

            playbackContextRef.current = null;

            if (
                playbackContext &&
                playbackContext.state !== "closed"
            ) {
                void playbackContext.close();
            }
        };

    }, [
        roomSession.roomCode,
        roomSession.participantId,
        roomSession.participantToken,
        roomSession.preferredLanguage,
        processRoomAudioPacket,
        stopMicrophone,
    ]);

    // ==================================================
    // DERIVED STATE (PHASE 3)
    // ==================================================

    const derivedMicState = (() => {
        if (activeSpeaker?.id === roomSession.participantId) {
            return "You're speaking";
        }
        if (isProcessingTranslation) {
            return "Translating…";
        }
        if (playingTurnId) {
            const lang = getLanguage(roomSession.preferredLanguage);
            return `Playing in ${lang.nativeName}`;
        }
        return "Mic on";
    })();

    const connectedCount =
        participants.filter(p => p.connected).length || 1;

    const listenerCount = participants.filter(
        p =>
            p.id !== (activeSpeaker?.id || roomSession.participantId) &&
            p.connected
    ).length;

    // ==================================================
    // USER INTERFACE
    // ==================================================

    return (
        <section className="room-presence">

            {/* STATUS LINE (PHASE 3) */}
            <StatusLine
                connectedCount={connectedCount}
                activeSpeaker={activeSpeaker}
                isProcessingTranslation={isProcessingTranslation}
                playingTurnLanguage={
                    playingTurnId ? roomSession.preferredLanguage : null
                }
                selfParticipantId={roomSession.participantId}
                listenerCount={listenerCount}
            />

            {error && (
                <div className="room-error-notice" role="alert">
                    {error}
                </div>
            )}

            {/* PARTICIPANT HEADING */}
            <div className="transcript-heading">
                <h2>Participants</h2>
                <span>{participants.length} / 3</span>
            </div>

            {/* PARTICIPANT ROSTER */}
            <div className="participant-list">
                {participants.map(participant => {
                    const isSelf =
                        participant.id === roomSession.participantId;

                    return (
                        <article
                            className="participant-row"
                            key={participant.id}
                        >
                            <div className="participant-avatar">
                                {participant.displayName
                                    .charAt(0)
                                    .toUpperCase()}
                            </div>

                            <div className="participant-info">
                                <strong>
                                    {participant.displayName}
                                    {isSelf ? " (You)" : ""}
                                </strong>

                                <span>
                                    {participant.spokenLanguage}
                                    {" → "}
                                    {participant.preferredLanguage}
                                </span>
                            </div>

                            <div className="participant-state">
                                <span>
                                    {participant.isMuted
                                        ? "Muted"
                                        : "Unmuted"}
                                </span>

                                <span>
                                    {participant.connected
                                        ? "Online"
                                        : "Connecting"}
                                </span>
                            </div>
                        </article>
                    );
                })}

                {participants.length === 0 && (
                    <div className="empty">
                        Waiting for room participants...
                    </div>
                )}
            </div>

            {/* LIVE CONVERSATION TRANSCRIPT (HERO) */}
            <ConversationFeed
                messages={messages}
                playingTurnId={playingTurnId}
                participants={participants}
                selfParticipantId={roomSession.participantId}
            />

            {/* SINGLE MEET-STYLE MIC CONTROL (PHASE 3) */}
            <div className="room-mic-bar">
                {micError ? (
                    <div className="mic-error-pill">
                        <span className="mic-error-text">{micError}</span>
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => void startAudioSession()}
                        >
                            Try again
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        className={`btn-meet-mic ${
                            isMuted ? "btn-meet-muted" : "btn-meet-active"
                        }`}
                        onClick={() => void toggleMute()}
                        disabled={connectionStatus !== "Connected" || isStarting}
                        aria-label={
                            isMuted ? "Unmute microphone" : "Mute microphone"
                        }
                    >
                        <span className="meet-mic-icon">
                            {isMuted ? (
                                <svg
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <line x1="1" y1="1" x2="23" y2="23" />
                                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                                    <line x1="12" y1="19" x2="12" y2="23" />
                                    <line x1="8" y1="23" x2="16" y2="23" />
                                </svg>
                            ) : (
                                <svg
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                    <line x1="12" y1="19" x2="12" y2="23" />
                                    <line x1="8" y1="23" x2="16" y2="23" />
                                </svg>
                            )}
                        </span>
                        <span className="meet-mic-label">
                            {isMuted ? "Muted" : derivedMicState}
                        </span>
                    </button>
                )}
            </div>

        </section>
    );
}
