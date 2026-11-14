import { getLanguage, getScriptGlyph } from "../languages";

export type ParticipantTileInfo = {
    id: string;
    displayName: string;
    spokenLanguage: string;
    preferredLanguage?: string;
    connected?: boolean;
    isMuted?: boolean;
    isAdmin?: boolean;
};

export type CaptionEntry = {
    text: string;
    active: boolean;
};

type ParticipantTilesProps = {
    participants: ParticipantTileInfo[];
    selfParticipantId: string;
    activeSpeakerId: string | null;
    roomCode: string;
    captionMap?: Record<string, CaptionEntry>;
    onCopyRoomCode: () => void;
    isSelfAdmin?: boolean;
    onRemoveParticipant?: (id: string) => void;
};

export default function ParticipantTiles({
    participants,
    selfParticipantId,
    activeSpeakerId,
    roomCode,
    captionMap = {},
    onCopyRoomCode,
    isSelfAdmin = false,
    onRemoveParticipant,
}: ParticipantTilesProps) {
    if (participants.length === 0) {
        return null;
    }

    // Determine adaptive grid modifier
    const gridClass = (() => {
        if (participants.length === 1) return "grid-1"; // 1 person + 1 invite tile
        if (participants.length === 2) return "grid-2";
        if (participants.length <= 4) return "grid-4";
        return "grid-many";
    })();

    return (
        <section className="stage-tiles-container" aria-label="Participants stage">
            <div className={`participant-grid ${gridClass}`}>
                {participants.map(p => {
                    const isSelf = p.id === selfParticipantId;
                    const isSpeaking = activeSpeakerId === p.id;
                    const spokenLang = getLanguage(p.spokenLanguage);
                    const scriptGlyph = getScriptGlyph(p.spokenLanguage);
                    const initial = (p.displayName || "P").trim().charAt(0).toUpperCase();
                    const isOnline = p.connected !== false;
                    const isMuted = p.isMuted === true;

                    const caption = captionMap[p.id];
                    const showCaption = Boolean(caption && caption.active && caption.text);

                    return (
                        <div
                            key={p.id}
                            className={`p-tile ${isSelf ? "tile-self" : ""} ${
                                isSpeaking ? "tile-speaking" : ""
                            }`}
                            data-participant-id={p.id}
                        >
                            {/* Faint oversized Indic script watermark behind avatar */}
                            <span className="tile-watermark-glyph" aria-hidden="true">
                                {scriptGlyph}
                            </span>

                            {/* Mic state icon top-right */}
                            <div
                                className={`tile-mic-icon ${isMuted ? "mic-muted" : isSpeaking ? "mic-speaking" : "mic-idle"}`}
                                title={isMuted ? "Microphone muted" : isSpeaking ? "Speaking" : "Mic ready"}
                                aria-label={isMuted ? "Muted" : isSpeaking ? "Speaking" : "Mic ready"}
                            >
                                {isMuted ? (
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
                                        <line x1="1" y1="1" x2="23" y2="23" />
                                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                                        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                                        <line x1="12" y1="19" x2="12" y2="23" />
                                        <line x1="8" y1="23" x2="16" y2="23" />
                                    </svg>
                                ) : (
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
                                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                        <line x1="12" y1="19" x2="12" y2="23" />
                                        <line x1="8" y1="23" x2="16" y2="23" />
                                    </svg>
                                )}
                            </div>

                            {/* Centered Avatar Disc with Online dot */}
                            <div className="tile-center-wrap">
                                <div className="tile-avatar-wrap">
                                    <div
                                        className={`tile-avatar ${
                                            isSpeaking ? "avatar-speaking" : ""
                                        }`}
                                    >
                                        {initial}
                                    </div>
                                    <span
                                        className={`tile-online-dot ${
                                            isOnline ? "dot-online" : "dot-offline"
                                        }`}
                                        title={isOnline ? "Online" : "Connecting"}
                                        aria-label={isOnline ? "Online" : "Connecting"}
                                    />
                                </div>
                            </div>

                            {/* CAPTION ON TILE: 1-2 lines live caption in listener's language (fades after 4s) */}
                            <div
                                className={`tile-caption ${showCaption ? "tile-caption-visible" : ""}`}
                                aria-live="polite"
                            >
                                <p className="tile-caption-text">
                                    {caption?.text || ""}
                                </p>
                            </div>

                            {/* Bottom Footer: Name, YOU tag, Host tag, Native language chip */}
                            <div className="tile-footer">
                                <div className="tile-footer-left">
                                    <span className="tile-name" title={p.displayName}>
                                        {p.displayName}
                                    </span>
                                    {isSelf && <span className="tile-you-tag">YOU</span>}
                                    {p.isAdmin && <span className="tile-host-pill">Host</span>}
                                </div>

                                <div className="tile-footer-right">
                                    <span className="tile-lang-chip" title={spokenLang.englishName}>
                                        <span className="tile-lang-native">{spokenLang.nativeName}</span>
                                        <span className="tile-lang-en">{spokenLang.englishName}</span>
                                    </span>
                                </div>
                            </div>

                            {/* Admin remove participant action */}
                            {isSelfAdmin && !isSelf && onRemoveParticipant && (
                                <button
                                    type="button"
                                    className="btn-remove-participant"
                                    title={`Remove ${p.displayName} from room`}
                                    aria-label={`Remove ${p.displayName} from room`}
                                    onClick={() => {
                                        if (window.confirm(`Remove ${p.displayName} from the room?`)) {
                                            onRemoveParticipant(p.id);
                                        }
                                    }}
                                >
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
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    );
                })}

                {/* 1 person: show dashed "Invite someone" tile so empty room reads as invitation */}
                {participants.length === 1 && (
                    <div className="p-tile p-tile-invite" role="region" aria-label="Invite someone">
                        <div className="invite-content">
                            <div className="invite-icon-wrap" aria-hidden="true">
                                <svg
                                    width="28"
                                    height="28"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.75"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                                    <circle cx="9" cy="7" r="4" />
                                    <line x1="19" y1="8" x2="19" y2="14" />
                                    <line x1="22" y1="11" x2="16" y2="11" />
                                </svg>
                            </div>
                            <h3 className="invite-title">Waiting for others</h3>
                            <code className="invite-code">{roomCode}</code>
                            <p className="invite-hint">Share this code with up to 4 participants</p>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm invite-copy-btn"
                                onClick={onCopyRoomCode}
                            >
                                Copy room code
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
