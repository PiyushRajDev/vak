
import { useEffect, useRef, useState } from "react";
import "./App.css";
import ReadyGate from "./components/ReadyGate";
import RoomLobby from "./components/RoomLobby";
import RoomPresence from "./components/RoomPresence";

type Transcript = {
    text: string;
    segment_id?: string;
    detected_language_code?: string;
    latency?: number;
    audio_duration_ms?: number;
};

type Translation = {
    originalText: string;
    translatedText: string;
    sourceLanguage: string;
    targetLanguage: string;
    latencyMs: number;
};

type RoomSession = {
    roomCode: string;
    participantId: string;
    participantToken: string;
    displayName: string;
    spokenLanguage: string;
    preferredLanguage: string;
};

const LANGUAGES = [
    { code: "en-IN", name: "English (India)" },
    { code: "hi-IN", name: "Hindi" },
    { code: "bn-IN", name: "Bengali" },
    { code: "gu-IN", name: "Gujarati" },
    { code: "kn-IN", name: "Kannada" },
    { code: "ml-IN", name: "Malayalam" },
    { code: "mr-IN", name: "Marathi" },
    { code: "pa-IN", name: "Punjabi" },
    { code: "ta-IN", name: "Tamil" },
    { code: "te-IN", name: "Telugu" },
];

function SingleUserDemo() {
    // Keep your existing source-language default.
    const [language, setLanguage] = useState("pa-IN");
    const [targetLanguage, setTargetLanguage] = useState("ta-IN");

    const [status, setStatus] = useState("Disconnected");
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState("");

    const [transcripts, setTranscripts] = useState<Transcript[]>([]);
    const [translations, setTranslations] = useState<Translation[]>([]);

    // Microphone and STT references.
    const wsRef = useRef<WebSocket | null>(null);
    const contextRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const processorRef = useRef<AudioWorkletNode | null>(null);
    const gainRef = useRef<GainNode | null>(null);

    // TTS playback references.
    const playbackContextRef = useRef<AudioContext | null>(null);
    const nextPlaybackTimeRef = useRef(0);

    const audioStartedRef = useRef(false);
    const idleWaiterRef = useRef<(() => void) | null>(null);

    // Convert each incoming PCM chunk into scheduled browser audio.
    const playPcmChunk = (data: ArrayBuffer) => {
        const context = playbackContextRef.current;

        if (!context) {
            throw new Error("Audio playback context is unavailable");
        }

        if (data.byteLength === 0 || data.byteLength % 2 !== 0) {
            throw new Error("Invalid PCM audio chunk");
        }

        // Timbre sends signed 16-bit little-endian PCM.
        const view = new DataView(data);
        const samples = new Float32Array(data.byteLength / 2);

        for (let i = 0; i < samples.length; i++) {
            samples[i] = view.getInt16(i * 2, true) / 32768;
        }

        const audioBuffer = context.createBuffer(
            1,
            samples.length,
            48000
        );

        audioBuffer.copyToChannel(samples, 0);

        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);

        // Schedule chunks sequentially to avoid overlapping audio.
        const startAt = Math.max(
            nextPlaybackTimeRef.current,
            context.currentTime + 0.08
        );

        source.start(startAt);

        nextPlaybackTimeRef.current = startAt + audioBuffer.duration;
    };

    const cleanup = async () => {
        const ws = wsRef.current;
        wsRef.current = null;

        if (ws && ws.readyState !== WebSocket.CLOSED) {
            ws.close(1000, "Client stopped");
        }

        sourceRef.current?.disconnect();
        sourceRef.current = null;

        processorRef.current?.disconnect();
        processorRef.current = null;

        gainRef.current?.disconnect();
        gainRef.current = null;

        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;

        const micContext = contextRef.current;
        contextRef.current = null;

        if (micContext && micContext.state !== "closed") {
            await micContext.close();
        }

        const playbackContext = playbackContextRef.current;
        playbackContextRef.current = null;

        if (
            playbackContext &&
            playbackContext.state !== "closed"
        ) {
            await playbackContext.close();
        }

        nextPlaybackTimeRef.current = 0;
        audioStartedRef.current = false;

        setIsRunning(false);
    };

    const startListening = async () => {
        setError("");
        setTranscripts([]);
        setTranslations([]);
        setStatus("Requesting microphone...");
        setIsRunning(true);

        audioStartedRef.current = false;
        idleWaiterRef.current = null;

        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error("Microphone access is unavailable");
            }

            // 1. Create playback context.
            const playbackContext = new AudioContext({
                sampleRate: 48000,
            });

            playbackContextRef.current = playbackContext;

            await playbackContext.resume();

            nextPlaybackTimeRef.current = 0;

            // 2. Get microphone access.
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
                video: false,
            });

            streamRef.current = stream;

            // 3. Create 16 kHz microphone context.
            const context = new AudioContext({
                sampleRate: 16000,
            });

            contextRef.current = context;

            await context.resume();

            if (context.sampleRate !== 16000) {
                throw new Error(
                    `Expected 16000 Hz audio, got ${context.sampleRate} Hz`
                );
            }

            // 4. Load PCM conversion worklet.
            await context.audioWorklet.addModule("/pcm-worklet.js");

            const source = context.createMediaStreamSource(stream);
            sourceRef.current = source;

            const processor = new AudioWorkletNode(
                context,
                "pcm16-processor",
                {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [1],
                }
            );

            processorRef.current = processor;

            const gain = context.createGain();
            gain.gain.value = 0;
            gainRef.current = gain;

            processor.connect(gain);
            gain.connect(context.destination);

            // 5. Connect to Vāk's backend proxy.
            const protocol =
                window.location.protocol === "https:" ? "wss:" : "ws:";

            const wsUrl =
                `${protocol}//${window.location.hostname}:8000/ws/stt` +
                `?language=${encodeURIComponent(language)}` +
                `&targetLanguage=${encodeURIComponent(targetLanguage)}`;

            const ws = new WebSocket(wsUrl);

            ws.binaryType = "arraybuffer";
            wsRef.current = ws;

            // 6. Forward microphone PCM frames.
            processor.port.onmessage = (
                event: MessageEvent<ArrayBuffer>
            ) => {
                if (
                    ws.readyState === WebSocket.OPEN &&
                    ws.bufferedAmount < 64 * 1024
                ) {
                    ws.send(event.data);
                }
            };

            ws.onopen = () => {
                setStatus("Connected to Vāk. Initializing Prisma...");
            };

            // 7. Handle JSON events and binary TTS audio.
            ws.onmessage = (event: MessageEvent) => {
                // Binary = Timbre PCM audio.
                if (event.data instanceof ArrayBuffer) {
                    try {
                        playPcmChunk(event.data);
                    } catch (err) {
                        setError(
                            err instanceof Error
                                ? err.message
                                : "Audio playback failed"
                        );
                    }

                    return;
                }

                let message: any;

                try {
                    message = JSON.parse(event.data);
                } catch {
                    console.error("Invalid backend message:", event.data);
                    return;
                }

                if (message.type === "connected") {
                    setStatus("Listening");

                    console.log("Prisma configuration:", message.config);

                    // Start microphone only after Prisma is ready.
                    if (!audioStartedRef.current) {
                        source.connect(processor);
                        audioStartedRef.current = true;
                    }

                    return;
                }

                if (message.type === "transcript") {
                    setTranscripts(previous => [
                        ...previous,
                        {
                            text: message.text,
                            segment_id: message.segment_id,
                            detected_language_code:
                                message.detected_language_code,
                            latency: message.latency,
                            audio_duration_ms: message.audio_duration_ms,
                        },
                    ]);

                    return;
                }

                if (message.type === "translation") {
                    setTranslations(previous => [
                        ...previous,
                        {
                            originalText: message.originalText,
                            translatedText: message.translatedText,
                            sourceLanguage: message.sourceLanguage,
                            targetLanguage: message.targetLanguage,
                            latencyMs: message.latencyMs,
                        },
                    ]);

                    setStatus("Translation received. Generating voice...");
                    return;
                }

                if (message.type === "tts_started") {
                    setStatus("Generating translated speech...");
                    return;
                }

                if (message.type === "tts_complete") {
                    console.log("TTS metrics:", message);
                    setStatus("Playing translated speech");
                    return;
                }

                if (message.type === "pipeline_idle") {
                    idleWaiterRef.current?.();
                    idleWaiterRef.current = null;
                    setStatus("Listening");
                    return;
                }

                if (message.type === "pipeline_error") {
                    setError(message.message);
                    setStatus("Pipeline error");
                    return;
                }

                if (message.type === "proxy_error") {
                    setError(message.message);
                    setStatus("Connection error");
                    return;
                }

                if (message.type === "provider_closed") {
                    setStatus("Speech service disconnected");
                    return;
                }

                console.log("Backend event:", message);
            };

            ws.onerror = () => {
                setError("WebSocket connection failed. Check the backend.");
                setStatus("Connection error");
            };

            ws.onclose = () => {
                if (wsRef.current === ws) {
                    setStatus("Disconnected");
                }
            };

            setStatus("Connecting to Prisma...");

        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Unknown error";

            setError(message);
            setStatus("Failed to start");

            await cleanup();
        }
    };

    const stopListening = async () => {
        setStatus("Finishing current speech...");

        // Stop microphone capture.
        sourceRef.current?.disconnect();
        sourceRef.current = null;

        audioStartedRef.current = false;

        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;

        // Allow already-produced audio frames to reach the backend.
        await new Promise(resolve => setTimeout(resolve, 100));

        const ws = wsRef.current;

        if (ws?.readyState === WebSocket.OPEN) {
            const idlePromise = new Promise<void>(resolve => {
                let finished = false;

                const finish = () => {
                    if (finished) return;

                    finished = true;
                    window.clearTimeout(timer);

                    if (idleWaiterRef.current === finish) {
                        idleWaiterRef.current = null;
                    }

                    resolve();
                };

                const timer = window.setTimeout(finish, 30000);

                idleWaiterRef.current = finish;

                ws.send(JSON.stringify({ type: "commit" }));
            });

            await idlePromise;
        }

        // Wait for all scheduled translated audio to finish.
        const playbackContext = playbackContextRef.current;

        if (playbackContext) {
            const remainingMs = Math.max(
                0,
                (nextPlaybackTimeRef.current -
                    playbackContext.currentTime) * 1000
            );

            await new Promise(resolve =>
                setTimeout(resolve, remainingMs + 100)
            );
        }

        await cleanup();
        setStatus("Stopped");
    };

    useEffect(() => {
        return () => {
            wsRef.current?.close();

            streamRef.current?.getTracks().forEach(track => track.stop());

            if (
                contextRef.current &&
                contextRef.current.state !== "closed"
            ) {
                void contextRef.current.close();
            }

            if (
                playbackContextRef.current &&
                playbackContextRef.current.state !== "closed"
            ) {
                void playbackContextRef.current.close();
            }
        };
    }, []);

    return (
        <main className="app">
            <header>
                <div className="brand">
                    वाक् <span>Vāk</span>
                </div>
                <p>Make different languages disappear.</p>
            </header>

            <section className="panel">
                <h1>Voice translation</h1>
                <p className="subheading">
                    Speak naturally. Vāk translates and re-voices your speech.
                </p>

                <label htmlFor="language">I'm speaking</label>

                <select
                    id="language"
                    value={language}
                    disabled={isRunning}
                    onChange={event => setLanguage(event.target.value)}
                >
                    {LANGUAGES.map(item => (
                        <option key={item.code} value={item.code}>
                            {item.name}
                        </option>
                    ))}
                </select>

                <label htmlFor="targetLanguage">
                    I want to hear
                </label>

                <select
                    id="targetLanguage"
                    value={targetLanguage}
                    disabled={isRunning}
                    onChange={event => setTargetLanguage(event.target.value)}
                >
                    {LANGUAGES.map(item => (
                        <option key={item.code} value={item.code}>
                            {item.name}
                        </option>
                    ))}
                </select>

                <div className="status">
                    <span
                        className={`status-dot ${
                            status === "Listening" ? "active" : ""
                        }`}
                    />
                    {status}
                </div>

                <div className="controls">
                    <button
                        onClick={startListening}
                        disabled={isRunning}
                    >
                        Start microphone
                    </button>

                    <button
                        className="stop"
                        onClick={stopListening}
                        disabled={!isRunning}
                    >
                        Stop
                    </button>
                </div>

                {error && (
                    <div className="error">
                        {error}
                    </div>
                )}
            </section>

            <section className="transcripts">
                <div className="transcript-heading">
                    <h2>Recognized speech</h2>
                    <span>{transcripts.length} segments</span>
                </div>

                {transcripts.length === 0 ? (
                    <div className="empty">
                        Your recognized speech will appear here.
                    </div>
                ) : (
                    transcripts.map((item, index) => (
                        <article
                            className="transcript"
                            key={item.segment_id || index}
                        >
                            <p>{item.text}</p>

                            <div className="metadata">
                                {item.detected_language_code}
                                {" · "}
                                {item.latency} ms processing
                                {" · "}
                                {item.audio_duration_ms} ms audio
                            </div>
                        </article>
                    ))
                )}
            </section>

            <section className="transcripts">
                <div className="transcript-heading">
                    <h2>Translated speech</h2>
                    <span>{translations.length} translations</span>
                </div>

                {translations.length === 0 ? (
                    <div className="empty">
                        Translated speech will appear here.
                    </div>
                ) : (
                    translations.map((item, index) => (
                        <article className="transcript" key={index}>
                            <p>{item.translatedText}</p>

                            <div className="metadata">
                                {item.sourceLanguage}
                                {" → "}
                                {item.targetLanguage}
                                {" · "}
                                {item.latencyMs} ms translation
                            </div>
                        </article>
                    ))
                )}
            </section>
        </main>
    );
}

const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

function App() {
    const [roomSession, setRoomSession] =
        useState<RoomSession | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [playbackContext, setPlaybackContext] =
        useState<AudioContext | null>(null);
    const [micStream, setMicStream] = useState<MediaStream | null>(null);

    const [showDiagnostics, setShowDiagnostics] = useState(false);
    const [copied, setCopied] = useState(false);
    const [roomError, setRoomError] = useState("");

    const copyRoomCode = async () => {
        if (!roomSession) return;

        try {
            await navigator.clipboard.writeText(roomSession.roomCode);
            setCopied(true);
            setRoomError("");
        } catch {
            setRoomError("Could not copy room code.");
        }
    };

    const leaveRoom = async () => {
        if (!roomSession) return;

        if (micStream) {
            micStream.getTracks().forEach(track => track.stop());
            setMicStream(null);
        }

        if (playbackContext && playbackContext.state !== "closed") {
            void playbackContext.close();
            setPlaybackContext(null);
        }

        try {
            const response = await fetch(
                `${API_BASE_URL}/api/rooms/${roomSession.roomCode}/participants/${roomSession.participantId}`,
                {
                    method: "DELETE",
                    headers: {
                        "x-participant-token": roomSession.participantToken,
                    },
                }
            );

            if (!response.ok && response.status !== 404) {
                throw new Error(`Could not leave room (${response.status})`);
            }
        } catch (error) {
            setRoomError(
                error instanceof Error
                    ? error.message
                    : "Failed to leave room."
            );
        } finally {
            setRoomSession(null);
            setIsReady(false);
            setShowDiagnostics(false);
            setRoomError("");
        }
    };

    if (!roomSession) {
        return (
            <RoomLobby
                onJoined={session => {
                    setRoomSession(session);
                    setIsReady(false);
                }}
            />
        );
    }

    if (!isReady) {
        return (
            <ReadyGate
                roomSession={roomSession}
                onStart={(stream, context) => {
                    setMicStream(stream);
                    setPlaybackContext(context);
                    setIsReady(true);
                }}
                onCancel={() => {
                    setRoomSession(null);
                    setIsReady(false);
                }}
            />
        );
    }

    if (showDiagnostics) {
        return (
            <>
                <div className="room-demo-return">
                    <button onClick={() => setShowDiagnostics(false)}>
                        Back to room
                    </button>
                </div>

                <SingleUserDemo />
            </>
        );
    }

    return (
        <main className="app">
            <header>
                <div className="brand">
                    वाक् <span>Vāk</span>
                </div>
                <p>Make different languages disappear.</p>
            </header>

            <section className="panel">
                <h1>Room {roomSession.roomCode}</h1>

                <p className="subheading">
                    Welcome, {roomSession.displayName}.
                    You're in a multilingual room.
                </p>

                <div className="room-details">
                    <p>
                        <strong>Speaking:</strong>{" "}
                        {roomSession.spokenLanguage}
                    </p>

                    <p>
                        <strong>Listening:</strong>{" "}
                        {roomSession.preferredLanguage}
                    </p>
                </div>

                <div className="room-actions">
                    <button onClick={copyRoomCode}>
                        {copied ? "Copied!" : "Copy room code"}
                    </button>

                    <button onClick={() => setShowDiagnostics(true)}>
                        Open single-user diagnostics
                    </button>

                    <button className="stop" onClick={leaveRoom}>
                        Leave room
                    </button>
                </div>

                {roomError && (
                    <div className="error">{roomError}</div>
                )}

                <RoomPresence
                    roomSession={roomSession}
                    playbackContext={playbackContext}
                    initialMicStream={micStream}
                />
            </section>
        </main>
    );
}

export default App;
