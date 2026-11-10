import { getLanguage } from "../languages";

export type ParticipantTileInfo = {
    id: string;
    displayName: string;
    spokenLanguage: string;
    preferredLanguage?: string;
    connected?: boolean;
    isMuted?: boolean;
};

type ParticipantTilesProps = {
    participants: ParticipantTileInfo[];
    selfParticipantId: string;
    activeSpeakerId: string | null;
};

export default function ParticipantTiles({
    participants,
    selfParticipantId,
    activeSpeakerId,
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
                                </div>

                                <span className="tile-spoken-native" title={spokenLang.englishName}>
                                    {spokenLang.nativeName}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
