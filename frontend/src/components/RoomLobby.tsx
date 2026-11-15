import { useState } from "react";
import { getLanguage } from "../languages";
import Wordmark from "./Wordmark";
import LanguagePicker from "./LanguagePicker";
import LandingPage from "../landing/LandingPage";

const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL ?? "";

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

    return (
        <LandingPage
            onCreateRoom={() => {
                setView("create");
                resetErrors();
            }}
            onJoinRoom={() => {
                setView("join");
                resetErrors();
            }}
        />
    );
}
