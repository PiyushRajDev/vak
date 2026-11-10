import { getLanguage } from "../languages";

export type ConnectionState =
    | "connected"
    | "connecting"
    | "reconnecting"
    | "error"
    | "disconnected";

type RoomHeaderProps = {
    roomCode: string;
    spokenLanguage: string;
    preferredLanguage: string;
    participantCount: number;
    connectionState: ConnectionState;
    copied: boolean;
    onCopyRoomCode: () => void;
    onLeaveRoom: () => void;
    onReconnect?: () => void;
};

export default function RoomHeader({
    roomCode,
    spokenLanguage,
    preferredLanguage,
    participantCount,
    connectionState,
    copied,
    onCopyRoomCode,
    onLeaveRoom,
    onReconnect,
}: RoomHeaderProps) {
    const spoken = getLanguage(spokenLanguage);
    const preferred = getLanguage(preferredLanguage);

    const connectionLabel = (() => {
        switch (connectionState) {
            case "connected":
                return "Connected";
            case "reconnecting":
                return "Reconnecting…";
            case "connecting":
                return "Connecting…";
            case "error":
                return "Connection lost";
            case "disconnected":
                return "Disconnected";
        }
    })();

    const connectionDotClass = (() => {
        switch (connectionState) {
            case "connected":
                return "conn-dot-online";
            case "reconnecting":
                return "conn-dot-reconnecting";
            case "connecting":
                return "conn-dot-reconnecting";
            case "error":
            case "disconnected":
                return "conn-dot-offline";
        }
    })();

    return (
        <header className="room-nav-header">
            {/* Left: Brand + Connection indicator + People count */}
            <div className="room-nav-left">
                <div className="brand room-nav-brand">
                    <span className="brand-indic">वाक्</span>
                    <span className="brand-latin">VĀK</span>
                </div>

                <div className="room-nav-meta">
                    <div className="room-connection-chip">
                        <span className={`conn-dot ${connectionDotClass}`} />
                        <span className="conn-label">{connectionLabel}</span>
                    </div>

                    <span className="room-nav-divider">·</span>

                    <span className="room-people-count">
                        {participantCount} {participantCount === 1 ? "person" : "people"}
                    </span>
                </div>
            </div>

            {/* Center: Language Pair */}
            <div className="room-nav-center">
                <div className="room-lang-pair" title={`${spoken.englishName} to ${preferred.englishName}`}>
                    <span className="pair-native">{spoken.nativeName}</span>
                    <span className="pair-arrow">→</span>
                    <span className="pair-native">{preferred.nativeName}</span>
                </div>
            </div>

            {/* Right: Room code + Copy + Leave */}
            <div className="room-nav-right">
                {connectionState === "error" && onReconnect && (
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={onReconnect}
                    >
                        Reconnect
                    </button>
                )}

                <div className="room-code-badge">
                    <span className="room-code-label">Room</span>
                    <code className="room-code-text">{roomCode}</code>
                    <button
                        type="button"
                        className={`btn-copy-code ${copied ? "copied" : ""}`}
                        onClick={onCopyRoomCode}
                        aria-label="Copy room code"
                    >
                        {copied ? "Copied" : "Copy"}
                    </button>
                </div>

                <button
                    type="button"
                    className="btn btn-leave"
                    onClick={onLeaveRoom}
                >
                    Leave
                </button>
            </div>
        </header>
    );
}

