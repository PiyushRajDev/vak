import { useState } from "react";
import { LANGUAGES, getLanguage } from "../languages";

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
    onJoined: (session: RoomSession) => void;
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

export default function RoomLobby({ onJoined }: RoomLobbyProps) {
    const [view, setView] = useState<LobbyView>("landing");

    // Form inputs
    const [displayName, setDisplayName] = useState("");
    const [roomCode, setRoomCode] = useState("");
    const [language, setLanguage] = useState("hi-IN");

    // "Your room is ready" state
    const [createdSession, setCreatedSession] = useState<RoomSession | null>(null);
    const [copiedCode, setCopiedCode] = useState(false);

    // Submission states
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

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
        setError("");

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
                    spokenLanguage: language,
                    preferredLanguage: language,
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

    async function handleJoinRoom(e: React.FormEvent) {
        e.preventDefault();
        setError("");

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

        try {
            const response = await fetch(
                `${API_BASE_URL}/api/rooms/${encodeURIComponent(code)}/join`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        displayName: name,
                        spokenLanguage: language,
                        preferredLanguage: language,
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

            onJoined({
                roomCode: result.room.roomCode,
                participantId: result.self.id,
                participantToken: result.participantToken,
                displayName: result.self.displayName,
                spokenLanguage: result.self.spokenLanguage,
                preferredLanguage: result.self.preferredLanguage,
                isAdmin: result.self.isAdmin ?? false,
            });
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Failed to join room."
            );
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
                <header className="lobby-topbar">
                    <div className="brand lobby-brand">
                        <span className="brand-indic">वाक्</span>
                        <span className="brand-latin">VĀK</span>
                    </div>
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
                            <span className="summary-label">Language</span>
                            <span className="summary-value">{spoken.nativeName} ({spoken.englishName})</span>
                        </div>
                    </div>

                    <div className="room-ready-actions">
                        <button
                            type="button"
                            className="btn btn-primary btn-block btn-lg"
                            onClick={() => onJoined(createdSession)}
                        >
                            Enter room
                        </button>
                        <button
                            type="button"
                            className="btn btn-ghost btn-block"
                            onClick={() => {
                                setCreatedSession(null);
                                setView("landing");
                            }}
                        >
                            Back to home
                        </button>
                    </div>
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
                            setError("");
                        }}
                    >
                        ← Back
                    </button>
                    <div className="brand lobby-brand">
                        <span className="brand-indic">वाक्</span>
                        <span className="brand-latin">VĀK</span>
                    </div>
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
                                onChange={e => setDisplayName(e.target.value)}
                                placeholder="Enter your name"
                                maxLength={24}
                                required
                                autoFocus
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="createLanguage" className="form-label">
                                Your language
                            </label>
                            <select
                                id="createLanguage"
                                className="form-select"
                                value={language}
                                onChange={e => setLanguage(e.target.value)}
                            >
                                {LANGUAGES.map(lang => (
                                    <option key={lang.code} value={lang.code}>
                                        {lang.nativeName} — {lang.englishName}
                                    </option>
                                ))}
                            </select>
                            <div className="form-hint" style={{ fontSize: "12px", color: "var(--text-muted, #94a3b8)", marginTop: "4px" }}>
                                You will speak and hear others translated into this language.
                            </div>
                        </div>

                        {error && (
                            <div className="lobby-error" role="alert">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="btn btn-primary btn-block btn-lg"
                            disabled={loading}
                        >
                            {loading ? "Creating room…" : "Create room"}
                        </button>
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
                            setError("");
                        }}
                    >
                        ← Back
                    </button>
                    <div className="brand lobby-brand">
                        <span className="brand-indic">वाक्</span>
                        <span className="brand-latin">VĀK</span>
                    </div>
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
                                onChange={e =>
                                    setRoomCode(e.target.value.toUpperCase())
                                }
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
                                onChange={e => setDisplayName(e.target.value)}
                                placeholder="Enter your name"
                                maxLength={24}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="joinLanguage" className="form-label">
                                Your language
                            </label>
                            <select
                                id="joinLanguage"
                                className="form-select"
                                value={language}
                                onChange={e => setLanguage(e.target.value)}
                            >
                                {LANGUAGES.map(lang => (
                                    <option key={lang.code} value={lang.code}>
                                        {lang.nativeName} — {lang.englishName}
                                    </option>
                                ))}
                            </select>
                            <div className="form-hint" style={{ fontSize: "12px", color: "var(--text-muted, #94a3b8)", marginTop: "4px" }}>
                                You will speak and hear others translated into this language.
                            </div>
                        </div>

                        {error && (
                            <div className="lobby-error" role="alert">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="btn btn-primary btn-block btn-lg"
                            disabled={loading}
                        >
                            {loading ? "Joining room…" : "Join conversation"}
                        </button>
                    </form>
                </div>
            </main>
        );
    }

    // ==================================================
    // RENDER: LANDING SCREEN (HERO + 3-STEP STRIP)
    // ==================================================
    return (
        <main className="lobby-container">
            <header className="lobby-topbar">
                <div className="brand lobby-brand">
                    <span className="brand-indic">वाक्</span>
                    <span className="brand-latin">VĀK</span>
                </div>
            </header>

            <section className="landing-hero">
                <h1 className="landing-headline">
                    Speak your language.
                    <br />
                    Hear theirs.
                </h1>

                <p className="landing-subhead">
                    Real-time conversations across Indian languages.
                </p>

                <div className="landing-actions">
                    <button
                        type="button"
                        className="btn btn-primary btn-lg"
                        onClick={() => {
                            setView("create");
                            setError("");
                        }}
                    >
                        Create a room
                    </button>

                    <button
                        type="button"
                        className="btn btn-secondary btn-lg"
                        onClick={() => {
                            setView("join");
                            setError("");
                        }}
                    >
                        Join a room
                    </button>
                </div>
            </section>

            {/* MINIMAL 3-STEP STRIP BELOW */}
            <section className="landing-steps-strip">
                <div className="landing-step">
                    <span className="step-num">01</span>
                    <div className="step-body">
                        <strong className="step-title">Speak naturally</strong>
                        <span className="step-text">
                            Talk in your own mother tongue with zero mode-switching.
                        </span>
                    </div>
                </div>

                <div className="landing-step-arrow">→</div>

                <div className="landing-step">
                    <span className="step-num">02</span>
                    <div className="step-body">
                        <strong className="step-title">Vāk translates</strong>
                        <span className="step-text">
                            Real-time neural pipeline translates and synthesizes speech.
                        </span>
                    </div>
                </div>

                <div className="landing-step-arrow">→</div>

                <div className="landing-step">
                    <span className="step-num">03</span>
                    <div className="step-body">
                        <strong className="step-title">They hear theirs</strong>
                        <span className="step-text">
                            Each listener receives spoken audio in their chosen language.
                        </span>
                    </div>
                </div>
            </section>
        </main>
    );
}
