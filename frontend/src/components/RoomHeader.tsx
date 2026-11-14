import { useState } from "react";
import Wordmark from "./Wordmark";

export type ConnectionState =
    | "connected"
    | "connecting"
    | "reconnecting"
    | "error"
    | "disconnected";

type RoomHeaderProps = {
    roomCode: string;
    participantCount: number;
    connectionState: ConnectionState;
    copied: boolean;
    onCopyRoomCode: () => void;
    onReconnect?: () => void;
};

export default function RoomHeader({
    roomCode,
    participantCount,
    connectionState,
    copied,
    onCopyRoomCode,
    onReconnect,
}: RoomHeaderProps) {
    const [copiedLink, setCopiedLink] = useState(false);

    const handleCopyInviteLink = async () => {
        try {
            // ONLY the room code in the URL, NEVER a participant token
            const inviteUrl = `${window.location.origin}/?join=${encodeURIComponent(roomCode)}`;
            await navigator.clipboard.writeText(inviteUrl);
            setCopiedLink(true);
            setTimeout(() => setCopiedLink(false), 2000);
        } catch {
            // fallback to copying just code
            onCopyRoomCode();
        }
    };

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
                return "Offline";
        }
    })();

    const connectionDotClass = (() => {
        switch (connectionState) {
            case "connected":
                return "conn-dot-online";
            case "reconnecting":
            case "connecting":
                return "conn-dot-reconnecting";
            case "error":
            case "disconnected":
                return "conn-dot-offline";
        }
    })();

    return (
        <header className="room-topbar" role="banner">
            {/* Left: Brand */}
            <div className="topbar-left">
                <Wordmark size="sm" />
            </div>

            {/* Center: Room Code Chip + Copy Code + Copy Invite Link */}
            <div className="topbar-center">
                <div className="room-code-chip">
                    <span className="chip-label">Room</span>
                    <code className="chip-code">{roomCode}</code>
                    <button
                        type="button"
                        className={`chip-copy-btn ${copied ? "copied" : ""}`}
                        onClick={onCopyRoomCode}
                        aria-label="Copy room code"
                        title="Copy room code"
                    >
                        {copied ? "Copied" : "Copy"}
                    </button>
                    <button
                        type="button"
                        className={`chip-copy-btn chip-link-btn ${copiedLink ? "copied" : ""}`}
                        onClick={() => void handleCopyInviteLink()}
                        aria-label="Copy invite link"
                        title="Copy invite link (room code only)"
                    >
                        {copiedLink ? "Link copied" : "Copy link"}
                    </button>
                </div>
            </div>

            {/* Right: Connection State + Single People Count */}
            <div className="topbar-right">
                {connectionState === "error" && onReconnect && (
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={onReconnect}
                    >
                        Reconnect
                    </button>
                )}

                <div className="conn-badge" aria-live="polite">
                    <span className={`conn-dot ${connectionDotClass}`} aria-hidden="true" />
                    <span className="conn-label">{connectionLabel}</span>
                </div>

                <div className="people-count" aria-label={`${participantCount} ${participantCount === 1 ? "person" : "people"} in room`}>
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    <span>{participantCount}</span>
                </div>
            </div>
        </header>
    );
}
