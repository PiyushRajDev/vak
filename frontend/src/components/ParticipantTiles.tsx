import { getLanguage } from "../languages";

export type ParticipantTileInfo = {
    id: string;
    displayName: string;
    spokenLanguage: string;
    preferredLanguage?: string;
    connected?: boolean;
    isMuted?: boolean;
    isAdmin?: boolean;
};

type ParticipantTilesProps = {
    participants: ParticipantTileInfo[];
    selfParticipantId: string;
    activeSpeakerId: string | null;
    isSelfAdmin?: boolean;
    onRemoveParticipant?: (id: string) => void;
};

export default function ParticipantTiles({
    participants,
    selfParticipantId,
    activeSpeakerId,
    isSelfAdmin = false,
    onRemoveParticipant,
}: ParticipantTilesProps) {
    if (participants.length === 0) {
        return null;
    }

    return (
        <section className="participant-tiles-container" aria-label="Room participants">
            <div className="participant-tiles-row">
                {participants.map(p => {
                    const isSelf = p.id === selfParticipantId;
                    const isSpeaking = activeSpeakerId === p.id;
                    const spokenLang = getLanguage(p.spokenLanguage);
                    const initial = (p.displayName || "P").trim().charAt(0).toUpperCase();
                    const isOnline = p.connected !== false;

                    return (
                        <div
                            key={p.id}
                            className={`participant-tile ${isSelf ? "tile-self" : ""} ${
                                isSpeaking ? "tile-speaking" : ""
                            }`}
                        >
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

                            <div className="tile-meta">
                                <div className="tile-name-row">
                                    <span className="tile-name">
                                        {p.displayName}
                                    </span>
                                    {isSelf && <span className="tile-you-pill">You</span>}
                                    {p.isAdmin && <span className="tile-host-pill">Host</span>}
                                </div>

                                <span className="tile-spoken-native" title={spokenLang.englishName}>
                                    {spokenLang.nativeName}
                                </span>
                            </div>

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
            </div>
        </section>
    );
}
