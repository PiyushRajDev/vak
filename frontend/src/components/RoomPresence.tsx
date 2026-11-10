
import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

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

type RoomTranscript = {
    id: string;
    speakerName: string;
    text: string;
    detectedLanguage?: string;
    latencyMs?: number;
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

    // Microphone.
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [isMuted, setIsMuted] = useState(false);

    const [audioStatus, setAudioStatus] =
        useState("Microphone off");

    // Room transcripts.
    const [roomTranscripts, setRoomTranscripts] =
        useState<RoomTranscript[]>([]);

    // Audio output.
    const [isAudioEnabled, setIsAudioEnabled] =
        useState(!!initialPlaybackContext);

    const [playbackStatus, setPlaybackStatus] =
        useState(
            initialPlaybackContext
                ? "Audio enabled"
                : "Audio playback disabled"
        );

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
            setIsAudioEnabled(true);
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

        setIsSpeaking(false);
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

            // 6. Forward microphone PCM to the room WebSocket.
            processor.port.onmessage = (
                event: MessageEvent<ArrayBuffer>
            ) => {
                const socket = wsRef.current;

                if (
                    !audioReadyRef.current ||
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

            setIsSpeaking(true);
            setAudioStatus("Listening — microphone audio is streaming");

        } catch (err) {
            await stopMicrophone();
            throw err;
        }
    }, [stopMicrophone, initialMicStream]);

    // --------------------------------------------------
    // START SPEAKING
    // --------------------------------------------------

    const startSpeaking = async () => {
        const socket = wsRef.current;

        if (
            socket?.readyState !== WebSocket.OPEN ||
            isStarting ||
            isSpeaking ||
            isMuted
        ) {
            return;
        }

        setError("");
        setIsStarting(true);
        setAudioStatus("Opening Prisma session...");

        try {
            // Register waiter BEFORE sending start_audio.
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
                            "Timed out waiting for Prisma to become ready."
                        )
                    );
                }, 15000);
            });

            socket.send(JSON.stringify({
                type: "start_audio",
            }));

            // Wait for backend confirmation.
            await readyPromise;

            setAudioStatus("Prisma ready — initializing microphone...");

            await startMicrophone();

        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "Could not start microphone.";

            setError(message);
            setAudioStatus("Microphone failed");

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
    };

    // --------------------------------------------------
    // STOP SPEAKING
    // --------------------------------------------------

    const stopSpeaking = async () => {
        audioReadyRef.current = false;

        await stopMicrophone();

        const socket = wsRef.current;

        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: "stop_audio",
            }));
        }

        setAudioStatus("Microphone stopped");
    };

    // --------------------------------------------------
    // MUTE / UNMUTE
    // --------------------------------------------------

    const toggleMute = async () => {
        const socket = wsRef.current;

        if (
            socket?.readyState !== WebSocket.OPEN ||
            isStarting
        ) {
            return;
        }

        const nextMuted = !isMuted;

        if (nextMuted) {
            await stopMicrophone();
        }

        const currentSocket = wsRef.current;

        if (currentSocket?.readyState !== WebSocket.OPEN) {
            return;
        }

        setAudioStatus("Updating mute state...");

        // Backend expects isMuted, not muted.
        currentSocket.send(JSON.stringify({
            type: "set_mute",
            isMuted: nextMuted,
        }));
    };

    // ==================================================
    // TTS AUDIO PLAYBACK
    // ==================================================

    // --------------------------------------------------
    // 1. PLAY ONE PCM CHUNK
    // --------------------------------------------------

    const schedulePcmChunk = useCallback((
        pcm: ArrayBuffer,
        sampleRate: number
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
                    chunk.sampleRate
                );

            } catch (err) {
                console.error("PCM playback error:", err);

                setError(
                    err instanceof Error
                        ? err.message
                        : "Audio playback failed."
                );

                setPlaybackStatus("Audio playback error");
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
    // 3. ENABLE BROWSER AUDIO
    // --------------------------------------------------

    const enableAudio = useCallback(async () => {
        try {
            let context = playbackContextRef.current;

            if (!context || context.state === "closed") {
                context = new AudioContext({
                    sampleRate: 48000,
                });

                playbackContextRef.current = context;

                nextPlaybackTimeRef.current = 0;
            }

            if (context.state === "suspended") {
                await context.resume();
            }

            if (context.state !== "running") {
                throw new Error(
                    "Browser audio output could not be activated."
                );
            }

            setIsAudioEnabled(true);

            setPlaybackStatus(
                "Audio enabled — waiting for translated speech"
            );

            // Play any audio already buffered.
            for (const turnId of turnAudioBuffersRef.current.keys()) {
                drainTurnBuffer(turnId);
            }

        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Could not enable audio."
            );

            setPlaybackStatus("Audio activation failed");
        }
    }, [drainTurnBuffer]);

    // --------------------------------------------------
    // 4. DECODE ROOM BINARY AUDIO ENVELOPE
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

            setPlaybackStatus("Receiving translated speech...");

            // This plays immediately when audio has been enabled.
            // Otherwise, the data remains buffered.
            drainTurnBuffer(metadata.turnId);

        } catch (err) {
            console.error("Room audio decoding failed:", err);

            setPlaybackStatus("Could not decode incoming audio");

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
                        setIsMuted(selfParticipant.isMuted);

                        setAudioStatus(current =>
                            selfParticipant.isMuted
                                ? "Muted"
                                : current === "Muted"
                                    ? "Microphone off"
                                    : current
                        );
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

                        setAudioStatus("Prisma session ready");

                        pending?.resolve();

                        break;
                    }

                    // --------------------------------------
                    // Transcript received from room speaker.
                    // --------------------------------------

                    case "speaker_transcript": {
                        const speaker = message.speaker ?? {};
                        const transcript = message.transcript ?? {};

                        if (typeof transcript.text !== "string") {
                            break;
                        }

                        const entry: RoomTranscript = {
                            id: String(
                                transcript.segmentId ??
                                `${speaker.id ?? "speaker"}-${Date.now()}`
                            ),

                            speakerName: String(
                                speaker.displayName ?? "Participant"
                            ),

                            text: transcript.text,

                            detectedLanguage:
                                transcript.detectedLanguage,

                            latencyMs:
                                typeof transcript.latencyMs === "number"
                                    ? transcript.latencyMs
                                    : undefined,
                        };

                        setRoomTranscripts(previous => [
                            ...previous,
                            entry,
                        ].slice(-30));

                        break;
                    }

                    // --------------------------------------
                    // Translation started.
                    // --------------------------------------

                    case "translation": {
                        setPlaybackStatus(
                            `Translating into ${message.targetLanguage ?? roomSession.preferredLanguage}...`
                        );

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

                        setPlaybackStatus(
                            isAudioEnabled
                                ? "Translated speech received"
                                : "Translated speech buffered — enable audio"
                        );

                        break;
                    }

                    // --------------------------------------
                    // STT or room errors.
                    // --------------------------------------

                    case "stt_error":
                    case "error":
                    case "room_error":
                    case "auth_error": {
                        const messageText =
                            message.message || "Room connection error.";

                        audioReadyRef.current = false;

                        clearPendingStart(messageText);

                        setError(messageText);
                        setAudioStatus("Audio error");

                        if (
                            message.type === "room_error" ||
                            message.type === "auth_error"
                        ) {
                            setConnectionStatus("Connection error");
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
                    setAudioStatus("Room connection closed");
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
    // USER INTERFACE
    // ==================================================

    return (
        <section className="room-presence">

            {/* PARTICIPANT HEADING */}

            <div className="transcript-heading">
                <h2>Participants</h2>

                <span>
                    {participants.length} / 3
                </span>
            </div>

            {/* ROOM CONNECTION */}

            <div className="room-connection">
                <span
                    className={`status-dot ${
                        connectionStatus === "Connected"
                            ? "active"
                            : ""
                    }`}
                />

                {connectionStatus}
            </div>

            {error && (
                <div className="error">
                    {error}
                </div>
            )}

            {/* AUDIO OUTPUT CONTROLS */}

            <div className="room-audio-controls">

                <div className="room-audio-status">
                    <span
                        className={`status-dot ${
                            isAudioEnabled ? "active" : ""
                        }`}
                    />

                    {playbackStatus}
                </div>

                <button
                    onClick={enableAudio}
                    disabled={isAudioEnabled}
                >
                    {isAudioEnabled
                        ? "Audio enabled"
                        : "Enable audio"}
                </button>

            </div>

            {/* MICROPHONE CONTROLS */}

            <div className="room-audio-controls">

                <div className="room-audio-status">
                    <span
                        className={`status-dot ${
                            isSpeaking ? "active" : ""
                        }`}
                    />

                    {audioStatus}
                </div>

                <div className="room-actions">

                    <button
                        onClick={startSpeaking}
                        disabled={
                            connectionStatus !== "Connected" ||
                            isStarting ||
                            isSpeaking ||
                            isMuted
                        }
                    >
                        {isStarting
                            ? "Connecting..."
                            : "Start speaking"}
                    </button>

                    <button
                        className="stop"
                        onClick={stopSpeaking}
                        disabled={!isSpeaking}
                    >
                        Stop speaking
                    </button>

                    <button
                        onClick={toggleMute}
                        disabled={
                            connectionStatus !== "Connected" ||
                            isStarting
                        }
                    >
                        {isMuted ? "Unmute" : "Mute"}
                    </button>

                </div>
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

            {/* LIVE ROOM TRANSCRIPTS */}

            <div className="room-transcript-feed">

                <div className="transcript-heading">
                    <h2>Live room transcripts</h2>

                    <span>
                        {roomTranscripts.length} segments
                    </span>
                </div>

                {roomTranscripts.length === 0 ? (

                    <div className="empty">
                        Recognized speech from room participants
                        will appear here.
                    </div>

                ) : (

                    roomTranscripts.map(item => (
                        <article
                            className="transcript"
                            key={item.id}
                        >

                            <strong>
                                {item.speakerName}
                            </strong>

                            <p>
                                {item.text}
                            </p>

                            <div className="metadata">

                                {item.detectedLanguage ??
                                    "Language unknown"}

                                {typeof item.latencyMs === "number"
                                    ? ` · ${item.latencyMs} ms`
                                    : ""}

                            </div>

                        </article>
                    ))

                )}

            </div>

        </section>
    );
}
