
import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import ControlDock from "./ControlDock";
import ConversationFeed, { type ConversationMessage } from "./ConversationFeed";
import DiagnosticsDrawer from "./DiagnosticsDrawer";
import ParticipantTiles, { type CaptionEntry } from "./ParticipantTiles";
import RoomHeader, { type ConnectionState } from "./RoomHeader";
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
    utteranceId?: string;
    generationId?: string;
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
    utteranceId?: string;
    generationId?: string;
    chunkIndex: number;
    payloadHash: string;
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
    onLeaveRoom?: () => void;
};

type PendingSttStart = {
    resolve: () => void;
    reject: (error: Error) => void;
};

const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

function computePayloadHash(buf: ArrayBuffer): string {
    const view = new Uint8Array(buf);
    let h = 0;
    const limit = Math.min(view.length, 64);
    for (let i = 0; i < limit; i++) {
        h = (h * 31 + view[i]) >>> 0;
    }
    return h.toString(16);
}

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
    onLeaveRoom,
}: Props) {

    // --------------------------------------------------
    // STATE
    // --------------------------------------------------

    const isMock = roomSession.participantId === "mock-p1";

    const [participants, setParticipants] =
        useState<Participant[]>(() => {
            if (isMock) {
                return [
                    { id: "mock-p1", displayName: "Priya", spokenLanguage: "hi-IN", preferredLanguage: "ta-IN", isMuted: false, connected: true },
                    { id: "mock-p2", displayName: "Karthik", spokenLanguage: "ta-IN", preferredLanguage: "hi-IN", isMuted: false, connected: true },
                ];
            }
            return [];
        });

    const [connectionState, setConnectionState] =
        useState<ConnectionState>(() => (isMock ? "connected" : "connecting"));
    const reconnectAttemptsRef = useRef(0);
    const reconnectTimerRef = useRef<number | null>(null);
    const connectFnRef = useRef<(() => void) | null>(null);

    const [copied, setCopied] = useState(false);
    const handleCopyRoomCode = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(roomSession.roomCode);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            console.error("Failed to copy room code");
        }
    }, [roomSession.roomCode]);

    const handleManualReconnect = useCallback(() => {
        if (reconnectTimerRef.current !== null) {
            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
        setConnectionState("connecting");
        if (connectFnRef.current) {
            connectFnRef.current();
        }
    }, []);

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
    } | null>(() => (isMock ? { id: "mock-p2", displayName: "Karthik" } : null));
    const speakerActivityTimerRef = useRef<number | null>(null);

    const [isProcessingTranslation, setIsProcessingTranslation] =
        useState(false);
    const [micError, setMicError] = useState<string | null>(null);

    // Live Captions on Tile (Signature feature: fades after 4s)
    const [captionMap, setCaptionMap] = useState<Record<string, CaptionEntry>>(() => {
        if (isMock) {
            return {
                "mock-p2": { text: "क्या कल कोई मीटिंग है?", active: true },
            };
        }
        return {} as Record<string, CaptionEntry>;
    });
    const captionTimersRef = useRef<Map<string, number>>(new Map());

    const triggerCaption = useCallback((speakerId: string, text: string) => {
        if (!text) return;
        setCaptionMap(prev => ({
            ...prev,
            [speakerId]: { text, active: true },
        }));

        const existingTimer = captionTimersRef.current.get(speakerId);
        if (existingTimer !== undefined) {
            window.clearTimeout(existingTimer);
        }

        const timer = window.setTimeout(() => {
            setCaptionMap(prev => {
                if (!prev[speakerId]) return prev;
                return {
                    ...prev,
                    [speakerId]: { ...prev[speakerId], active: false },
                };
            });
            captionTimersRef.current.delete(speakerId);
        }, 4000);

        captionTimersRef.current.set(speakerId, timer);
    }, []);

    // UI Panel controls
    const [showRail, setShowRail] = useState(true);
    const [showDiagnostics, setShowDiagnostics] = useState(false);
    const [dismissedHeadphoneTip, setDismissedHeadphoneTip] = useState(false);
    const [currentPreferredLang, setCurrentPreferredLang] = useState(roomSession.preferredLanguage);

    const handleChangePreferredLanguage = useCallback(async (newLang: string) => {
        try {
            const response = await fetch(
                `${API_BASE_URL}/api/rooms/${roomSession.roomCode}/participants/${roomSession.participantId}`,
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        "x-participant-token": roomSession.participantToken,
                    },
                    body: JSON.stringify({ preferredLanguage: newLang }),
                }
            );

            if (response.ok) {
                roomSession.preferredLanguage = newLang;
                setCurrentPreferredLang(newLang);
            }
        } catch (err) {
            console.error("Failed to update listening language:", err);
        }
    }, [roomSession]);

    // Room conversation messages (Phase 2)
    const [messages, setMessages] =
        useState<ConversationMessage[]>(() => {
            if (isMock) {
                return [
                    {
                        id: "m1",
                        speakerId: "mock-p2",
                        speakerName: "Karthik",
                        sourceLanguage: "ta-IN",
                        targetLanguage: "ta-IN",
                        isSelf: false,
                        originalText: "நாளைக்கு மீட்டிங் இருக்கா?",
                        translatedText: "क्या कल कोई मीटिंग है?",
                        timestamp: Date.now() - 10000,
                        latencyMs: 380,
                    },
                    {
                        id: "m2",
                        speakerId: "mock-p1",
                        speakerName: "Priya",
                        sourceLanguage: "hi-IN",
                        isSelf: true,
                        originalText: "हाँ, सुबह दस बजे।",
                        timestamp: Date.now() - 5000,
                        latencyMs: 290,
                    },
                ];
            }
            return [];
        });

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
    const micWorkletContextRef = useRef<AudioContext | null>(null);
    const micContextStateHandlerRef = useRef<(() => void) | null>(null);
    const micRecoveryTimerRef = useRef<number | null>(null);
    const micRecoveryRef = useRef<() => void>(() => {});
    const sttStartInFlightRef = useRef(false);
    const sttReconnectTimerRef = useRef<number | null>(null);
    const sttReconnectAttemptsRef = useRef(0);
    const startAudioSessionRef = useRef<() => void>(() => {});
    const scheduleSttReconnectRef = useRef<() => void>(() => {});

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

    // Retain completed turn IDs to prevent race-condition re-creation
    // when chunks arrive out of order or after completion.
    const completedTurnsRef = useRef<Set<string>>(new Set());

    // --------------------------------------------------
    // MICROPHONE CLEANUP
    // --------------------------------------------------

    const stopMicrophone = useCallback(async () => {
        // Disable frame forwarding before stopping tracks. This also prevents
        // an intentional stop from being mistaken for a device disconnect.
        audioReadyRef.current = false;

        micSourceRef.current?.disconnect();
        micSourceRef.current = null;

        micProcessorRef.current?.port.close();
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

        if (context && micContextStateHandlerRef.current) {
            context.removeEventListener(
                "statechange",
                micContextStateHandlerRef.current
            );
        }
        micContextStateHandlerRef.current = null;

        // RoomLobby already unlocks this context during the user's join
        // gesture. Keep it alive for TTS playback when the mic is muted.
        if (
            context &&
            context !== playbackContextRef.current &&
            context.state !== "closed"
        ) {
            await context.close();
        }
    }, []);

    // --------------------------------------------------
    // MICROPHONE INITIALIZATION
    // --------------------------------------------------

    const startMicrophone = useCallback(async () => {
        try {
            // Reuse the stream granted by the lobby whenever it is still live.
            let stream = micStreamRef.current;
            if (!stream || !stream.active) {
                if (
                    initialMicStream?.active &&
                    initialMicStream.getAudioTracks().some(
                        track => track.readyState === "live"
                    )
                ) {
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

            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length === 0) {
                throw new Error("No microphone audio track is available.");
            }

            audioTracks.forEach(track => {
                if (track.readyState !== "live") {
                    throw new Error("The microphone track is no longer live.");
                }

                track.enabled = true;

                track.addEventListener("ended", () => {
                    if (audioReadyRef.current && !isMutedRef.current) {
                        micRecoveryRef.current();
                    }
                }, { once: true });

                track.addEventListener("mute", () => {
                    if (audioReadyRef.current && !isMutedRef.current) {
                        setMicError("Microphone input was interrupted. Checking the device…");
                    }
                });

                track.addEventListener("unmute", () => {
                    if (!isMutedRef.current) {
                        setMicError(null);
                    }
                });
            });

            // Use the context unlocked by the lobby. Forcing a second 16 kHz
            // context fails on some browser/device combinations; the worklet
            // now resamples this context's native rate to the STT's 16 kHz.
            let context = playbackContextRef.current;
            if (!context || context.state === "closed") {
                context = new AudioContext();
                playbackContextRef.current = context;
            }

            micContextRef.current = context;

            if (context.state === "suspended") {
                await context.resume();
            }
            if (context.state !== "running") {
                throw new Error("Audio capture could not start. Tap the microphone to retry.");
            }

            const handleContextStateChange = () => {
                if (
                    context.state === "suspended" &&
                    audioReadyRef.current &&
                    !isMutedRef.current
                ) {
                    void context.resume().catch(error => {
                        console.warn("Could not resume microphone AudioContext:", error);
                        setMicError("Audio capture was suspended. Tap the microphone to resume.");
                    });
                }
            };

            context.addEventListener("statechange", handleContextStateChange);
            micContextStateHandlerRef.current = handleContextStateChange;

            // The worklet is registered once per AudioContext. The same
            // playback context is reused across mute/unmute cycles.
            if (micWorkletContextRef.current !== context) {
                await context.audioWorklet.addModule("/pcm-worklet.js");
                micWorkletContextRef.current = context;
            }

            const source = context.createMediaStreamSource(stream);
            micSourceRef.current = source;

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

            processor.addEventListener("processorerror", () => {
                if (audioReadyRef.current && !isMutedRef.current) {
                    setMicError("Microphone processing stopped. Reconnecting…");
                    micRecoveryRef.current();
                }
            });

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

            // Keep the AudioWorklet alive without feeding mic audio back to
            // the speakers. TTS nodes share this same AudioContext.
            const gain = context.createGain();
            gain.gain.value = 0;
            micGainRef.current = gain;

            source.connect(processor);
            processor.connect(gain);
            gain.connect(context.destination);

        } catch (err) {
            await stopMicrophone();
            throw err;
        }
    }, [stopMicrophone, initialMicStream]);

    // Recover from a device unplug, OS-level input interruption, or worklet
    // failure without requiring the participant to leave and rejoin.
    micRecoveryRef.current = () => {
        if (
            micRecoveryTimerRef.current !== null ||
            isMutedRef.current ||
            !audioReadyRef.current
        ) {
            return;
        }

        audioReadyRef.current = false;
        setMicError("Microphone disconnected. Reconnecting…");

        micRecoveryTimerRef.current = window.setTimeout(() => {
            micRecoveryTimerRef.current = null;

            void (async () => {
                await stopMicrophone();

                if (
                    isMutedRef.current ||
                    wsRef.current?.readyState !== WebSocket.OPEN
                ) {
                    return;
                }

                try {
                    await startMicrophone();
                    audioReadyRef.current = true;
                    setMicError(null);
                } catch (error) {
                    console.error("Microphone recovery failed:", error);
                    audioReadyRef.current = false;
                    setMicError("Microphone unavailable. Reconnect it, then tap the microphone to retry.");
                }
            })();
        }, 300);
    };

    // --------------------------------------------------
    // AUDIO SESSION INITIALIZATION (MEET STYLE)
    // --------------------------------------------------

    const startAudioSession = useCallback(async () => {
        const socket = wsRef.current;

        if (
            socket?.readyState !== WebSocket.OPEN ||
            sttStartInFlightRef.current ||
            isMutedRef.current
        ) {
            return;
        }

        sttStartInFlightRef.current = true;
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
                            "Timed out waiting for the speech service."
                        )
                    );
                }, 15000);
            });

            socket.send(JSON.stringify({
                type: "start_audio",
            }));

            await readyPromise;

            // On a provider reconnect, capture may still be running. Reuse
            // its graph instead of attaching a second source/processor.
            const captureAlreadyRunning =
                Boolean(
                    micStreamRef.current?.active &&
                    micSourceRef.current &&
                    micProcessorRef.current &&
                    micContextRef.current?.state === "running"
                );

            if (captureAlreadyRunning) {
                micStreamRef.current
                    ?.getAudioTracks()
                    .forEach(track => {
                        if (track.readyState === "live") {
                            track.enabled = true;
                        }
                    });
            } else {
                await startMicrophone();
            }

            setMicError(null);

        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "Unable to start microphone audio.";

            console.error("Microphone session failed:", err);
            setMicError(message);

            const currentSocket = wsRef.current;
            if (currentSocket?.readyState === WebSocket.OPEN) {
                currentSocket.send(JSON.stringify({
                    type: "stop_audio",
                }));
            }

            await stopMicrophone();

        } finally {
            sttStartInFlightRef.current = false;
            setIsStarting(false);
        }
    }, [startMicrophone, stopMicrophone]);

    startAudioSessionRef.current = () => {
        void startAudioSession();
    };

    scheduleSttReconnectRef.current = () => {
        if (
            isMutedRef.current ||
            sttReconnectTimerRef.current !== null
        ) {
            return;
        }

        if (sttReconnectAttemptsRef.current >= 5) {
            setMicError("Speech service is unavailable. Tap the microphone to retry.");
            return;
        }

        const delay = Math.min(
            500 * Math.pow(2, sttReconnectAttemptsRef.current),
            8000
        );
        sttReconnectAttemptsRef.current += 1;
        setMicError("Speech connection lost. Reconnecting…");

        sttReconnectTimerRef.current = window.setTimeout(() => {
            sttReconnectTimerRef.current = null;

            if (
                !isMutedRef.current &&
                wsRef.current?.readyState === WebSocket.OPEN
            ) {
                startAudioSessionRef.current();
            }
        }, delay);
    };

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

    micStreamRef.current
        ?.getAudioTracks()
        .forEach(track => {
            track.enabled = false;
        });

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

    // Keyboard Shortcuts (M: mic, C: conversation rail, D: diagnostics, Esc: close)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
                return;
            }

            if (e.key === "m" || e.key === "M") {
                e.preventDefault();
                void toggleMute();
            } else if (e.key === "c" || e.key === "C") {
                e.preventDefault();
                setShowRail(prev => !prev);
            } else if (e.key === "d" || e.key === "D") {
                e.preventDefault();
                setShowDiagnostics(prev => !prev);
            } else if (e.key === "Escape") {
                setShowDiagnostics(false);
                if (window.innerWidth < 1100) {
                    setShowRail(false);
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [toggleMute]);

    // ==================================================
    // TTS AUDIO PLAYBACK
    // ==================================================

    // --------------------------------------------------
    // 1. PLAY ONE PCM CHUNK
    // --------------------------------------------------

    const schedulePcmChunk = useCallback((
        pcm: ArrayBuffer,
        sampleRate: number,
        turnId?: string,
        meta?: {
            utteranceId?: string;
            generationId?: string;
            chunkIndex?: number;
            payloadHash?: string;
        }
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

        const scheduledEndTime = startAt + audioBuffer.duration;
        nextPlaybackTimeRef.current = scheduledEndTime;

        // Structured Trace: BOUNDARY 4 (AudioBufferSourceNode.start())
        console.log(JSON.stringify({
            t: "TTS_TRACE",
            event: "sourceStart",
            turnId: turnId || null,
            utteranceId: meta?.utteranceId || null,
            generationId: meta?.generationId || null,
            chunkIndex: meta?.chunkIndex ?? null,
            payloadHash: meta?.payloadHash || null,
            chunkDuration: Number(audioBuffer.duration.toFixed(4)),
            sourceStartTime: Number(startAt.toFixed(4)),
            scheduledEndTime: Number(scheduledEndTime.toFixed(4)),
            contextTime: Number(context.currentTime.toFixed(4)),
            ts: Date.now(),
        }));

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
                    turnId,
                    {
                        utteranceId: chunk.utteranceId,
                        generationId: chunk.generationId,
                        chunkIndex: chunk.chunkIndex,
                        payloadHash: chunk.payloadHash,
                    }
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

        // Release completed turn buffers and register in completedTurns.
        if (turn.complete && turn.chunks.size === 0) {
            completedTurnsRef.current.add(turnId);
            if (completedTurnsRef.current.size > 200) {
                const oldest = completedTurnsRef.current.values().next().value;
                if (oldest) completedTurnsRef.current.delete(oldest);
            }
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

            // Ignore packets for turns that have already finished playback.
            if (completedTurnsRef.current.has(metadata.turnId)) {
                return;
            }

            // Get or create the buffer for this speech turn.
            let turn = turnAudioBuffersRef.current.get(
                metadata.turnId
            );

            if (!turn) {
                const startIndex = metadata.chunkIndex === 0 ? 0 : 1;
                turn = {
                    nextChunkIndex: startIndex,
                    chunks: new Map(),
                    complete: false,
                };

                turnAudioBuffersRef.current.set(
                    metadata.turnId,
                    turn
                );
            }

            if (
                metadata.chunkIndex === 0 &&
                turn.nextChunkIndex === 1 &&
                !turn.chunks.has(1)
            ) {
                turn.nextChunkIndex = 0;
            }

            // Ignore duplicate or previously played chunks.
            if (
                metadata.chunkIndex < turn.nextChunkIndex ||
                turn.chunks.has(metadata.chunkIndex)
            ) {
                return;
            }

            const payloadHash = computePayloadHash(pcm);
            const chunkDuration = (pcm.byteLength / 2) / sampleRate;

            // Structured Trace: BOUNDARY 3 (Frontend WebSocket audio receive)
            console.log(JSON.stringify({
                t: "TTS_TRACE",
                event: "chunkReceived",
                turnId: metadata.turnId,
                utteranceId: metadata.utteranceId || null,
                generationId: metadata.generationId || null,
                chunkIndex: metadata.chunkIndex,
                payloadHash,
                chunkDuration: Number(chunkDuration.toFixed(4)),
                byteLength: pcm.byteLength,
                ts: Date.now(),
            }));

            turn.chunks.set(metadata.chunkIndex, {
                pcm,
                sampleRate,
                utteranceId: metadata.utteranceId,
                generationId: metadata.generationId,
                chunkIndex: metadata.chunkIndex,
                payloadHash,
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
        if (roomSession.participantId === "mock-p1") {
            return;
        }

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

                setConnectionState("connecting");

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
                        setConnectionState("connected");
                        reconnectAttemptsRef.current = 0;
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

                        if (sttReconnectTimerRef.current !== null) {
                            window.clearTimeout(sttReconnectTimerRef.current);
                            sttReconnectTimerRef.current = null;
                        }
                        sttReconnectAttemptsRef.current = 0;
                        audioReadyRef.current = true;
                        setMicError(null);

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

                        // Trigger live caption on tile (my own original or interim speaker text)
                        triggerCaption(
                            isSelf ? roomSession.participantId : (speaker.id || "speaker"),
                            transcript.text
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
                            // Update live tile caption in my listening language
                            if (speakerId) {
                                triggerCaption(speakerId, translatedText);
                            }

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
                                drainTurnBuffer(turnId);

                                if (turn.chunks.size === 0) {
                                    completedTurnsRef.current.add(turnId);
                                    if (completedTurnsRef.current.size > 200) {
                                        const oldest = completedTurnsRef.current.values().next().value;
                                        if (oldest) completedTurnsRef.current.delete(oldest);
                                    }
                                    turnAudioBuffersRef.current.delete(
                                        turnId
                                    );
                                }
                            } else {
                                completedTurnsRef.current.add(turnId);
                                if (completedTurnsRef.current.size > 200) {
                                    const oldest = completedTurnsRef.current.values().next().value;
                                    if (oldest) completedTurnsRef.current.delete(oldest);
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
                        if (!isMutedRef.current) {
                            scheduleSttReconnectRef.current();
                        }
                        break;
                    }

                    case "stt_disconnected": {
                        audioReadyRef.current = false;
                        clearPendingStart("Speech service disconnected.");
                        if (!isMutedRef.current) {
                            scheduleSttReconnectRef.current();
                        }
                        break;
                    }

                    case "audio_not_ready": {
                        audioReadyRef.current = false;
                        clearPendingStart("Speech service is not ready.");
                        if (!isMutedRef.current) {
                            scheduleSttReconnectRef.current();
                        }
                        break;
                    }

                    case "audio_backpressure": {
                        console.warn("Room audio backpressure:", message.message);
                        setMicError("Network congestion is delaying microphone audio.");
                        break;
                    }

                    case "audio_flow_resumed": {
                        setMicError(null);
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
                            setConnectionState("error");
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
                    if (reconnectAttemptsRef.current >= 5) {
                        setConnectionState("error");
                    }
                }
            };

            // ----------------------------------------------
            // Socket closed (Auto Reconnect with Backoff).
            // ----------------------------------------------

            ws.onclose = () => {
                if (wsRef.current === ws) {
                    wsRef.current = null;
                }

                audioReadyRef.current = false;

                if (sttReconnectTimerRef.current !== null) {
                    window.clearTimeout(sttReconnectTimerRef.current);
                    sttReconnectTimerRef.current = null;
                }

                clearPendingStart("Room connection closed.");

                void stopMicrophone();

                if (!disposed) {
                    if (reconnectAttemptsRef.current < 5) {
                        reconnectAttemptsRef.current += 1;
                        setConnectionState("reconnecting");
                        const delay = Math.min(
                            1000 * Math.pow(1.5, reconnectAttemptsRef.current - 1),
                            6000
                        );
                        reconnectTimerRef.current = window.setTimeout(() => {
                            if (!disposed && connectFnRef.current) {
                                connectFnRef.current();
                            }
                        }, delay);
                    } else {
                        setConnectionState("error");
                    }
                }
            };
        };

        connectFnRef.current = connect;

        try {
            connect();

        } catch {
            setConnectionState("error");
        }

        // --------------------------------------------------
        // Cleanup.
        // --------------------------------------------------

        return () => {
            disposed = true;

            if (sttReconnectTimerRef.current !== null) {
                window.clearTimeout(sttReconnectTimerRef.current);
                sttReconnectTimerRef.current = null;
            }
            if (micRecoveryTimerRef.current !== null) {
                window.clearTimeout(micRecoveryTimerRef.current);
                micRecoveryTimerRef.current = null;
            }

            if (reconnectTimerRef.current !== null) {
                window.clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            connectFnRef.current = null;

            audioReadyRef.current = false;

            clearPendingStart("Room view unmounted.");

            if (wsRef.current === ws) {
                wsRef.current = null;
            }

            if (ws && ws.readyState < WebSocket.CLOSING) {
                ws.close(1000, "Room view unmounted");
            }

            void stopMicrophone();

            // Clear unfinished audio buffers and completed turn registry.
            turnAudioBuffersRef.current.clear();
            completedTurnsRef.current.clear();

            // Clear caption timers
            captionTimersRef.current.forEach(timer => window.clearTimeout(timer));
            captionTimersRef.current.clear();

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
        <div className="room-layout">
            {/* Top Bar: Wordmark, Room Code Chip + Copy Link, Connection Status, Single People Count */}
            <RoomHeader
                roomCode={roomSession.roomCode}
                participantCount={connectedCount}
                connectionState={connectionState}
                copied={copied}
                onCopyRoomCode={handleCopyRoomCode}
                onReconnect={handleManualReconnect}
            />

            {error && (
                <div className="room-error-notice" role="alert">
                    {error}
                </div>
            )}

            <div className="room-stage-wrap">
                {/* Center Stage: Adaptive Tiles Grid + Inline Status */}
                <main className="room-stage">
                    {/* Headphone tip: dismissible inside the room */}
                    {!dismissedHeadphoneTip && (
                        <div className="room-headphone-tip-banner" role="status">
                            <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10a9 9 0 0 1 18 0v9a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
                            </svg>
                            <span>Headphones recommended for the best experience.</span>
                            <button
                                type="button"
                                className="tip-dismiss-btn"
                                onClick={() => setDismissedHeadphoneTip(true)}
                                aria-label="Dismiss tip"
                            >
                                ✕
                            </button>
                        </div>
                    )}

                    {/* Inline Stage Status Line */}
                    <StatusLine
                        activeSpeaker={activeSpeaker}
                        isProcessingTranslation={isProcessingTranslation}
                        playingTurnLanguage={
                            playingTurnId ? roomSession.preferredLanguage : null
                        }
                        selfParticipantId={roomSession.participantId}
                        listenerCount={listenerCount}
                    />

                    {/* Adaptive Participant Tile Grid with Script Watermarks & Live Captions on Tile */}
                    <ParticipantTiles
                        participants={participants}
                        selfParticipantId={roomSession.participantId}
                        activeSpeakerId={activeSpeaker?.id || null}
                        roomCode={roomSession.roomCode}
                        captionMap={captionMap}
                        onCopyRoomCode={handleCopyRoomCode}
                    />
                </main>

                {/* Conversation Rail: Persistent on desktop (≥1100px), bottom sheet on mobile */}
                <div className={`room-rail-container ${showRail ? "rail-open" : "rail-closed"}`}>
                    <ConversationFeed
                        messages={messages}
                        playingTurnId={playingTurnId}
                        participants={participants}
                        selfParticipantId={roomSession.participantId}
                        onClose={() => setShowRail(false)}
                    />
                </div>
            </div>

            {/* Floating Control Dock (Bottom Center) */}
            <div className="dock-floating-container">
                <ControlDock
                    micState={isMuted ? "Muted" : derivedMicState}
                    isMuted={isMuted}
                    micError={micError}
                    isStarting={isStarting}
                    isDisabled={connectionState !== "connected"}
                    onToggleMic={() => void toggleMute()}
                    onRetryMic={() => void startAudioSession()}
                    spokenLanguage={roomSession.spokenLanguage}
                    preferredLanguage={currentPreferredLang}
                    onChangePreferredLanguage={handleChangePreferredLanguage}
                    showRail={showRail}
                    onToggleRail={() => setShowRail(prev => !prev)}
                    onOpenDiagnostics={() => setShowDiagnostics(true)}
                    onLeaveRoom={onLeaveRoom || (() => {})}
                />
            </div>

            {/* Hidden Diagnostics Drawer */}
            <DiagnosticsDrawer
                isOpen={showDiagnostics}
                onClose={() => setShowDiagnostics(false)}
                roomCode={roomSession.roomCode}
                participantId={roomSession.participantId}
                spokenLanguage={roomSession.spokenLanguage}
                preferredLanguage={roomSession.preferredLanguage}
                messages={messages}
                playbackContextState={playbackContextRef.current?.state}
                micContextState={micContextRef.current?.state}
            />
        </div>
    );
}
