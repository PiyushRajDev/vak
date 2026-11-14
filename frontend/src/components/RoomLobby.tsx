import { useEffect, useState } from "react";
import { LANGUAGES, getLanguage } from "../languages";
import Wordmark from "./Wordmark";
import LanguagePicker from "./LanguagePicker";

const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL ?? "";

// Real phrases translated through Vāk's Sarvam pipeline
const HERO_PHRASES = [
    {
        speaker: "Priya",
        initial: "प",
        nativeLang: "हिन्दी",
        englishLang: "Hindi",
        originalText: "कल कॉलेज आ रहे हो?",
        translations: [
            { nativeLang: "தமிழ்", englishLang: "Tamil", text: "நாளைக்கு நீ காலேஜுக்கு போறியா?" },
            { nativeLang: "ಕನ್ನಡ", englishLang: "Kannada", text: "ನೀನು ನಾಳೆ ಕಾಲೇಜಿಗೆ ಹೋಗುತ್ತೀಯಾ?" },
            { nativeLang: "తెలుగు", englishLang: "Telugu", text: "రేపు మీరు కాలేజీలో ఉంటారా?" },
        ],
    },
    {
        speaker: "Karthik",
        initial: "க",
        nativeLang: "தமிழ்",
        englishLang: "Tamil",
        originalText: "நாளைக்கு மீட்டிங் இருக்கா?",
        translations: [
            { nativeLang: "हिन्दी", englishLang: "Hindi", text: "क्या कल कोई मीटिंग है?" },
            { nativeLang: "ಕನ್ನಡ", englishLang: "Kannada", text: "ನಾಳೆ ಸಭೆ ಇದೆಯೇ?" },
            { nativeLang: "తెలుగు", englishLang: "Telugu", text: "రేపు సమావేశం ఉందా?" },
        ],
    },
    {
        speaker: "Ananya",
        initial: "ಅ",
        nativeLang: "ಕನ್ನಡ",
        englishLang: "Kannada",
        originalText: "ನಾಳೆ ನಾವು ಯಾವಾಗ ಭೇಟಿಯಾಗೋಣ?",
        translations: [
            { nativeLang: "हिन्दी", englishLang: "Hindi", text: "हम कल कब मिलेंगे?" },
            { nativeLang: "தமிழ்", englishLang: "Tamil", text: "நாளைக்கு நாம் எப்போது சந்திக்கலாம்?" },
            { nativeLang: "తెలుగు", englishLang: "Telugu", text: "రేపు మనం ఎప్పుడు కలుద్దాం?" },
        ],
    },
];

export type RoomSession = {
    roomCode: string;
    participantId: string;
    participantToken: string;
    displayName: string;
    spokenLanguage: string;
    preferredLanguage: string;
    isAdmin?: boolean;
};

type RoomLobbyProps = {
    onJoined: (session: RoomSession, stream: MediaStream, playbackContext: AudioContext) => void;
};

type RoomApiResponse = {
    room: {
        roomCode: string;
    };
    self: {
        id: string;
        displayName: string;
        spokenLanguage: string;
        preferredLanguage: string;
        isAdmin?: boolean;
    };
    participantToken: string;
};

type LobbyView = "landing" | "create" | "join";

async function unlockAudioAndGetMic(): Promise<{ playbackContext: AudioContext; stream: MediaStream }> {
    // 1. Unlock AudioContext — must be in user gesture
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
        throw new Error("Audio playback is not supported by your browser.");
    }

    const playbackContext = new AudioCtx({ sampleRate: 48000 });
    if (playbackContext.state === "suspended") {
        await playbackContext.resume();
    }

    // Silent buffer to fully unlock
    const buf = playbackContext.createBuffer(1, 1, 48000);
    const src = playbackContext.createBufferSource();
    src.buffer = buf;
    src.connect(playbackContext.destination);
    src.start(0);

    // 2. Request mic
    if (!navigator.mediaDevices?.getUserMedia) {
        const isInsecure =
            window.location.protocol !== "https:" &&
            window.location.hostname !== "localhost" &&
            window.location.hostname !== "127.0.0.1";
        if (isInsecure) {
            const secErr = new DOMException("Microphone access requires HTTPS or localhost.", "SecurityError");
            throw secErr;
        }
        throw new Error("Could not access microphone. Please try again.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        },
        video: false,
    });

    // Start muted
    stream.getAudioTracks().forEach(t => {
        t.enabled = false;
    });

    return { playbackContext, stream };
}

function parseMicError(err: unknown): string {
    if (err instanceof DOMException) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            return "Mic blocked. Click the microphone icon in your browser bar and allow access, then try again.";
        }
        if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
            return "No microphone found. Please connect one and try again.";
        }
        if (err.name === "NotReadableError" || err.name === "TrackStartError") {
            return "Mic is in use by another app. Close it and try again.";
        }
        if (err.name === "SecurityError") {
            return "Microphone access requires HTTPS or localhost.";
        }
    }
    if (err instanceof TypeError && typeof window !== "undefined") {
        const isInsecure =
            window.location.protocol !== "https:" &&
            window.location.hostname !== "localhost" &&
            window.location.hostname !== "127.0.0.1";
        if (isInsecure) {
            return "Microphone access requires HTTPS or localhost.";
        }
    }
    if (err instanceof Error) {
        if (err.message.includes("HTTPS") || err.message.includes("localhost")) {
            return "Microphone access requires HTTPS or localhost.";
        }
    }
    return "Could not access microphone. Please try again.";
}

export default function RoomLobby({ onJoined }: RoomLobbyProps) {
    const [view, setView] = useState<LobbyView>("landing");

    // Form inputs
    const [displayName, setDisplayName] = useState("");
    const [roomCode, setRoomCode] = useState("");
    const [spokenLanguage, setSpokenLanguage] = useState("hi-IN");
    const [preferredLanguage, setPreferredLanguage] = useState("hi-IN");

    // "Your room is ready" state
    const [createdSession, setCreatedSession] = useState<RoomSession | null>(null);
    const [copiedCode, setCopiedCode] = useState(false);

    // Pending session for Join retry
    const [pendingJoinSession, setPendingJoinSession] = useState<RoomSession | null>(null);

    // Submission states
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [micError, setMicError] = useState("");

    function resetErrors() {
        setError("");
        setMicError("");
    }

    // Hero phrase rotation
    const [phraseIndex, setPhraseIndex] = useState(0);

    useEffect(() => {
        if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
        }
        const timer = setInterval(() => {
            setPhraseIndex(prev => (prev + 1) % HERO_PHRASES.length);
        }, 5000);
        return () => clearInterval(timer);
    }, []);

    async function handleCopyCode(code: string) {
        try {
            await navigator.clipboard.writeText(code);
            setCopiedCode(true);
            setTimeout(() => setCopiedCode(false), 2000);
        } catch {
            // Clipboard fallback
        }
    }

    async function handleCreateRoom(e: React.FormEvent) {
        e.preventDefault();
        resetErrors();

        const name = displayName.trim();
        if (!name) {
            setError("Please enter your name.");
            return;
        }

        setLoading(true);

        try {
            const response = await fetch(`${API_BASE_URL}/api/rooms`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    displayName: name,
                    spokenLanguage,
                    preferredLanguage,
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Could not create room.");
            }

            const result = data as RoomApiResponse;
            if (!result.self?.id || !result.participantToken) {
                throw new Error("Invalid room response from server.");
            }

            const session: RoomSession = {
                roomCode: result.room.roomCode,
                participantId: result.self.id,
                participantToken: result.participantToken,
                displayName: result.self.displayName,
                spokenLanguage: result.self.spokenLanguage,
                preferredLanguage: result.self.preferredLanguage,
                isAdmin: result.self.isAdmin ?? true,
            };

            setCreatedSession(session);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Failed to create room."
            );
        } finally {
            setLoading(false);
        }
    }

    async function handleEnterCreatedRoom() {
        if (!createdSession) return;
        setLoading(true);
        setMicError("");

        let playbackContext: AudioContext | null = null;
        let stream: MediaStream | null = null;

        try {
            const res = await unlockAudioAndGetMic();
            playbackContext = res.playbackContext;
            stream = res.stream;
            onJoined(createdSession, stream, playbackContext);
        } catch (err) {
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
            }
            if (playbackContext && playbackContext.state !== "closed") {
                void playbackContext.close();
            }
            setMicError(parseMicError(err));
        } finally {
            setLoading(false);
        }
    }

    async function handleJoinRoom(e: React.FormEvent) {
        e.preventDefault();
        resetErrors();

        const name = displayName.trim();
        const code = roomCode.trim().toUpperCase();

        if (!code) {
            setError("Please enter a room code.");
            return;
        }
        if (!name) {
            setError("Please enter your name.");
            return;
        }

        setLoading(true);

        let session = pendingJoinSession;

        if (!session) {
            try {
                const response = await fetch(
                    `${API_BASE_URL}/api/rooms/${encodeURIComponent(code)}/join`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            displayName: name,
                            spokenLanguage,
                            preferredLanguage,
                        }),
                    }
                );

                const data = await response.json();
                if (!response.ok) {
                    if (response.status === 404) {
                        throw new Error("Room not found. Check the code and try again.");
                    } else if (response.status === 409 || data.error?.includes("full")) {
                        throw new Error("This room is already full (max 5 participants).");
                    }
                    throw new Error(data.error || "Could not join room.");
                }

                const result = data as RoomApiResponse;
                if (!result.self?.id || !result.participantToken) {
                    throw new Error("Invalid room response from server.");
                }

                session = {
                    roomCode: result.room.roomCode,
                    participantId: result.self.id,
                    participantToken: result.participantToken,
                    displayName: result.self.displayName,
                    spokenLanguage: result.self.spokenLanguage,
                    preferredLanguage: result.self.preferredLanguage,
                    isAdmin: result.self.isAdmin ?? false,
                };
                setPendingJoinSession(session);
            } catch (err) {
                setError(
                    err instanceof Error ? err.message : "Failed to join room."
                );
                setLoading(false);
                return;
            }
        }

        // Inside user gesture — unlock AudioContext and request mic
        let playbackContext: AudioContext | null = null;
        let stream: MediaStream | null = null;

        try {
            const res = await unlockAudioAndGetMic();
            playbackContext = res.playbackContext;
            stream = res.stream;
            onJoined(session, stream, playbackContext);
        } catch (err) {
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
            }
            if (playbackContext && playbackContext.state !== "closed") {
                void playbackContext.close();
            }
            setMicError(parseMicError(err));
        } finally {
            setLoading(false);
        }
    }

    async function handleRetryMicJoin() {
        if (!pendingJoinSession) return;
        setLoading(true);
        setMicError("");

        let playbackContext: AudioContext | null = null;
        let stream: MediaStream | null = null;

        try {
            const res = await unlockAudioAndGetMic();
            playbackContext = res.playbackContext;
            stream = res.stream;
            onJoined(pendingJoinSession, stream, playbackContext);
        } catch (err) {
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
            }
            if (playbackContext && playbackContext.state !== "closed") {
                void playbackContext.close();
            }
            setMicError(parseMicError(err));
        } finally {
            setLoading(false);
        }
    }

    // ==================================================
    // RENDER: CREATED ROOM STATE ("Your room is ready")
    // ==================================================
    if (createdSession) {
        const spoken = getLanguage(createdSession.spokenLanguage);

        return (
            <main className="lobby-container">
                <header className="lobby-topbar" style={{ justifyContent: "center" }}>
                    <Wordmark size="md" />
                </header>

                <div className="room-ready-card">
                    <div className="room-ready-badge">Room Created</div>
                    <h1 className="room-ready-title">Your room is ready</h1>
                    <p className="room-ready-subheading">
                        Share this code with up to 4 other participants so they can join.
                    </p>

                    <div className="room-code-display-box">
                        <span className="room-code-display-label">Room Code</span>
                        <div className="room-code-display-row">
                            <span className="room-code-display-value">
                                {createdSession.roomCode}
                            </span>
                            <button
                                type="button"
                                className={`btn-copy-code-lg ${copiedCode ? "copied" : ""}`}
                                onClick={() => void handleCopyCode(createdSession.roomCode)}
                            >
                                {copiedCode ? "Copied!" : "Copy Code"}
                            </button>
                        </div>
                    </div>

                    <div className="room-ready-summary">
                        <div className="ready-summary-row">
                            <span className="summary-label">Joining as</span>
                            <span className="summary-value">{createdSession.displayName}</span>
                        </div>
                        <div className="ready-summary-row">
                            <span className="summary-label">Speaking</span>
                            <span className="summary-value">{spoken.nativeName}</span>
                        </div>
                    </div>

                    <div className="room-ready-actions">
                        <button
                            type="button"
                            className="btn btn-primary btn-block btn-lg"
                            disabled={loading}
                            onClick={() => void handleEnterCreatedRoom()}
                        >
                            {loading ? "Setting up audio…" : (micError ? "Try again" : "Enter room")}
                        </button>

                        {micError && (
                            <div className="mic-error-banner" role="alert">
                                <p>{micError}</p>
                            </div>
                        )}

                        <button
                            type="button"
                            className="btn btn-ghost btn-block"
                            disabled={loading}
                            onClick={() => {
                                setCreatedSession(null);
                                resetErrors();
                                setView("landing");
                            }}
                        >
                            Back to home
                        </button>
                    </div>

                    <p className="lobby-footer-tip">Headphones recommended.</p>
                </div>
            </main>
        );
    }

    // ==================================================
    // RENDER: CREATE ROOM VIEW
    // ==================================================
    if (view === "create") {
        return (
            <main className="lobby-container">
                <header className="lobby-topbar">
                    <button
                        type="button"
                        className="btn-back"
                        onClick={() => {
                            setView("landing");
                            resetErrors();
                        }}
                    >
                        ← Back
                    </button>
                    <Wordmark size="md" />
                </header>

                <div className="lobby-card">
                    <h1 className="lobby-card-title">Create a room</h1>
                    <p className="lobby-card-desc">
                        Set up a real-time multilingual room. You will get a code to invite others.
                    </p>

                    <form onSubmit={handleCreateRoom} className="lobby-form">
                        <div className="form-group">
                            <label htmlFor="displayName" className="form-label">
                                Your name
                            </label>
                            <input
                                id="displayName"
                                type="text"
                                className="form-input"
                                value={displayName}
                                onChange={e => {
                                    setDisplayName(e.target.value);
                                    if (error) setError("");
                                }}
                                placeholder="Enter your name"
                                maxLength={24}
                                required
                                autoFocus
                            />
                        </div>

                        <div className="form-group">
                            <LanguagePicker
                                id="create-spoken-language"
                                label="I speak"
                                value={spokenLanguage}
                                onChange={code => {
                                    setSpokenLanguage(code);
                                    resetErrors();
                                }}
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <LanguagePicker
                                id="create-preferred-language"
                                label="I want to hear"
                                value={preferredLanguage}
                                onChange={code => {
                                    setPreferredLanguage(code);
                                    resetErrors();
                                }}
                                disabled={loading}
                            />
                        </div>

                        {error && (
                            <div className="lobby-error" role="alert">
                                {error}
                            </div>
                        )}

                        {micError && (
                            <div className="mic-error-banner" role="alert">
                                <p>{micError}</p>
                            </div>
                        )}

                        <button
                            type="submit"
                            className="btn btn-primary btn-block btn-lg"
                            disabled={loading}
                        >
                            {loading ? "Creating room…" : "Create room"}
                        </button>

                        <p className="lobby-footer-tip">Headphones recommended.</p>
                    </form>
                </div>
            </main>
        );
    }

    // ==================================================
    // RENDER: JOIN ROOM VIEW
    // ==================================================
    if (view === "join") {
        return (
            <main className="lobby-container">
                <header className="lobby-topbar">
                    <button
                        type="button"
                        className="btn-back"
                        onClick={() => {
                            setView("landing");
                            resetErrors();
                        }}
                    >
                        ← Back
                    </button>
                    <Wordmark size="md" />
                </header>

                <div className="lobby-card">
                    <h1 className="lobby-card-title">Join a room</h1>
                    <p className="lobby-card-desc">
                        Enter the 6-character room code shared by the room creator.
                    </p>

                    <form onSubmit={handleJoinRoom} className="lobby-form">
                        <div className="form-group">
                            <label htmlFor="roomCode" className="form-label">
                                Room code
                            </label>
                            <input
                                id="roomCode"
                                type="text"
                                className="form-input form-input-code"
                                value={roomCode}
                                onChange={e => {
                                    setRoomCode(e.target.value.toUpperCase());
                                    resetErrors();
                                    setPendingJoinSession(null);
                                }}
                                placeholder="e.g. F5418A"
                                maxLength={6}
                                required
                                autoFocus
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="displayName" className="form-label">
                                Your name
                            </label>
                            <input
                                id="displayName"
                                type="text"
                                className="form-input"
                                value={displayName}
                                onChange={e => {
                                    setDisplayName(e.target.value);
                                    resetErrors();
                                    setPendingJoinSession(null);
                                }}
                                placeholder="Enter your name"
                                maxLength={24}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <LanguagePicker
                                id="join-spoken-language"
                                label="I speak"
                                value={spokenLanguage}
                                onChange={code => {
                                    setSpokenLanguage(code);
                                    resetErrors();
                                    setPendingJoinSession(null);
                                }}
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <LanguagePicker
                                id="join-preferred-language"
                                label="I want to hear"
                                value={preferredLanguage}
                                onChange={code => {
                                    setPreferredLanguage(code);
                                    resetErrors();
                                    setPendingJoinSession(null);
                                }}
                                disabled={loading}
                            />
                        </div>

                        {error && (
                            <div className="lobby-error" role="alert">
                                {error}
                            </div>
                        )}

                        {micError && (
                            <div className="mic-error-banner" role="alert">
                                <p>{micError}</p>
                            </div>
                        )}

                        {micError && pendingJoinSession ? (
                            <button
                                type="button"
                                className="btn btn-primary btn-block btn-lg"
                                disabled={loading}
                                onClick={() => void handleRetryMicJoin()}
                            >
                                {loading ? "Connecting…" : "Try again"}
                            </button>
                        ) : (
                            <button
                                type="submit"
                                className="btn btn-primary btn-block btn-lg"
                                disabled={loading}
                            >
                                {loading ? "Joining room…" : "Join conversation"}
                            </button>
                        )}

                        <p className="lobby-footer-tip">Headphones recommended.</p>
                    </form>
                </div>
            </main>
        );
    }

    // ==================================================
    // RENDER: REDESIGNED LANDING VIEW
    // ==================================================
    return (
        <main className="landing">
            <nav className="landing-nav">
                <Wordmark size="md" />
                <div className="nav-actions">
                    <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                            setView("join");
                            resetErrors();
                        }}
                    >
                        Join a room
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                            setView("create");
                            resetErrors();
                        }}
                    >
                        Create a room
                    </button>
                </div>
            </nav>

            <section className="landing-hero">
                <h1>
                    Speak your language.
                    <br />
                    Hear theirs.
                </h1>
                <p className="hero-sub">
                    Real-time conversations across Indian languages.
                </p>
                <div className="hero-ctas">
                    <button
                        type="button"
                        className="btn btn-primary btn-lg"
                        onClick={() => {
                            setView("create");
                            resetErrors();
                        }}
                    >
                        Create a room
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost btn-lg"
                        onClick={() => {
                            setView("join");
                            resetErrors();
                        }}
                    >
                        Join a room
                    </button>
                </div>

                {/* Translation moment card — pure HTML/CSS visual with genuine output */}
                {(() => {
                    const activePhrase = HERO_PHRASES[phraseIndex];
                    return (
                        <div className="hero-card" aria-label="Live translation preview">
                            <div className="hero-card-inner">
                                {/* Speaker tile */}
                                <div className="card-speaker-tile">
                                    <div className="card-avatar speaking-ring" aria-hidden="true">
                                        {activePhrase.initial}
                                    </div>
                                    <div className="card-speaker-info">
                                        <span className="card-speaker-name">{activePhrase.speaker}</span>
                                        <span className="card-lang-chip">
                                            {activePhrase.nativeLang} <span className="lang-en-sm">{activePhrase.englishLang}</span>
                                        </span>
                                    </div>
                                </div>

                                {/* The original phrase */}
                                <p className="card-phrase-original">{activePhrase.originalText}</p>

                                {/* Translation states in other scripts */}
                                <div className="card-translations">
                                    {activePhrase.translations.map((trans, i) => (
                                        <div key={i} className="card-trans-row">
                                            <span className="card-lang-chip-sm">
                                                {trans.nativeLang} <span className="lang-en-sm">{trans.englishLang}</span>
                                            </span>
                                            <span className="card-trans-text">
                                                {trans.text}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                {/* Playing indicator */}
                                <div className="card-playing-pill">
                                    <span className="playing-dot" aria-hidden="true" />
                                    Playing translation
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </section>

            <section className="how-it-works">
                <div className="steps-grid">
                    <div className="step">
                        <span className="step-num">01</span>
                        <strong>Speak naturally</strong>
                        <span>Talk in your mother tongue with zero mode-switching.</span>
                    </div>
                    <div className="step">
                        <span className="step-num">02</span>
                        <strong>Vāk translates</strong>
                        <span>Neural pipeline translates and synthesizes.</span>
                    </div>
                    <div className="step">
                        <span className="step-num">03</span>
                        <strong>They hear theirs</strong>
                        <span>Each listener receives audio in their language.</span>
                    </div>
                </div>
            </section>

            <section className="languages-section">
                <div className="languages-grid">
                    {LANGUAGES.map(l => (
                        <span key={l.code} className="lang-chip">
                            {l.nativeName} <span className="lang-chip-en">{l.englishName}</span>
                        </span>
                    ))}
                </div>
            </section>

            <section className="pipeline-section">
                <div className="pipeline-row">
                    <span className="pipe-step">🎙 Speech</span>
                    <span className="pipe-arrow" aria-hidden="true">→</span>
                    <span className="pipe-step">📝 Text (Prisma STT)</span>
                    <span className="pipe-arrow" aria-hidden="true">→</span>
                    <span className="pipe-step">🌐 Translation (Sarvam AI)</span>
                    <span className="pipe-arrow" aria-hidden="true">→</span>
                    <span className="pipe-step">🔊 Speech (Timbre TTS)</span>
                </div>
                <p className="pipeline-note">
                    Speech recognition, translation, and voice synthesis happen in real time.
                </p>
            </section>

            <section className="cta-band">
                <h2>Ready to try?</h2>
                <div>
                    <button
                        type="button"
                        className="btn btn-primary btn-lg"
                        onClick={() => {
                            setView("create");
                            resetErrors();
                        }}
                    >
                        Create a room
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost btn-lg"
                        onClick={() => {
                            setView("join");
                            resetErrors();
                        }}
                    >
                        Join a room
                    </button>
                </div>
            </section>

            <footer className="landing-footer">
                <Wordmark size="sm" />
                <span className="footer-copy">© 2025 Vāk</span>
            </footer>
        </main>
    );
}
