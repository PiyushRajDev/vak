
import { useState } from "react";

const API_BASE =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const LANGUAGES = [
    { code: "en-IN", name: "English" },
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

export type RoomSession = {
    roomCode: string;
    participantId: string;
    participantToken: string;
    displayName: string;
    spokenLanguage: string;
    preferredLanguage: string;
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
    };
    participantToken: string;
};

export default function RoomLobby({ onJoined }: RoomLobbyProps) {
    const [mode, setMode] = useState<"create" | "join">("create");

    const [displayName, setDisplayName] = useState("");
    const [roomCode, setRoomCode] = useState("");

    // Preserve the existing application defaults.
    const [spokenLanguage, setSpokenLanguage] = useState("pa-IN");
    const [preferredLanguage, setPreferredLanguage] = useState("ta-IN");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();

        setError("");

        const name = displayName.trim();

        if (!name) {
            setError("Please enter your display name.");
            return;
        }

        if (mode === "join" && !roomCode.trim()) {
            setError("Please enter a room code.");
            return;
        }

        setLoading(true);

        try {
            const endpoint =
                mode === "create"
                    ? `${API_BASE}/api/rooms`
                    : `${API_BASE}/api/rooms/${encodeURIComponent(
                        roomCode.trim().toUpperCase()
                    )}/join`;

            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    displayName: name,
                    spokenLanguage,
                    preferredLanguage,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || "Unable to enter the room."
                );
            }

            const result = data as RoomApiResponse;

            if (!result.self?.id || !result.participantToken) {
                throw new Error("Invalid room response from server.");
            }

            // Keep the private token in application memory.
            // Never print it in console logs.
            onJoined({
                roomCode: result.room.roomCode,
                participantId: result.self.id,
                participantToken: result.participantToken,
                displayName: result.self.displayName,
                spokenLanguage: result.self.spokenLanguage,
                preferredLanguage: result.self.preferredLanguage,
            });

        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Something went wrong."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="app">
            <header>
                <div className="brand">
                    वाक् <span>Vāk</span>
                </div>
                <p>Make different languages disappear.</p>
            </header>

            <section className="panel room-lobby">
                <h1>Enter a conversation</h1>

                <p className="subheading">
                    Speak your language. Connect with everyone.
                </p>

                <div className="room-tabs">
                    <button
                        type="button"
                        className={mode === "create" ? "selected" : ""}
                        onClick={() => {
                            setMode("create");
                            setError("");
                        }}
                    >
                        Create room
                    </button>

                    <button
                        type="button"
                        className={mode === "join" ? "selected" : ""}
                        onClick={() => {
                            setMode("join");
                            setError("");
                        }}
                    >
                        Join room
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <label htmlFor="displayName">Your name</label>

                    <input
                        id="displayName"
                        value={displayName}
                        onChange={event =>
                            setDisplayName(event.target.value)
                        }
                        placeholder="Enter your name"
                        maxLength={24}
                        required
                    />

                    {mode === "join" && (
                        <>
                            <label htmlFor="roomCode">Room code</label>

                            <input
                                id="roomCode"
                                value={roomCode}
                                onChange={event =>
                                    setRoomCode(event.target.value.toUpperCase())
                                }
                                placeholder="e.g. F5418A"
                                maxLength={6}
                                required
                            />
                        </>
                    )}

                    <label htmlFor="spokenLanguage">
                        I speak
                    </label>

                    <select
                        id="spokenLanguage"
                        value={spokenLanguage}
                        onChange={event =>
                            setSpokenLanguage(event.target.value)
                        }
                    >
                        {LANGUAGES.map(language => (
                            <option
                                key={language.code}
                                value={language.code}
                            >
                                {language.name}
                            </option>
                        ))}
                    </select>

                    <label htmlFor="preferredLanguage">
                        I want to hear
                    </label>

                    <select
                        id="preferredLanguage"
                        value={preferredLanguage}
                        onChange={event =>
                            setPreferredLanguage(event.target.value)
                        }
                    >
                        {LANGUAGES.map(language => (
                            <option
                                key={language.code}
                                value={language.code}
                            >
                                {language.name}
                            </option>
                        ))}
                    </select>

                    {error && (
                        <div className="error">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="room-submit"
                    >
                        {loading
                            ? "Connecting..."
                            : mode === "create"
                                ? "Create room"
                                : "Join conversation"}
                    </button>
                </form>

                <p className="room-hint">
                    Up to 3 participants per room.
                </p>
            </section>
        </main>
    );
}
