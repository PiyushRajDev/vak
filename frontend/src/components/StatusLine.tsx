import { getLanguage } from "../languages";

type StatusLineProps = {
    connectedCount: number;
    activeSpeaker: { id: string; displayName: string } | null;
    isProcessingTranslation: boolean;
    playingTurnLanguage?: string | null;
    selfParticipantId: string;
    listenerCount: number;
};

export default function StatusLine({
    connectedCount,
    activeSpeaker,
    isProcessingTranslation,
    playingTurnLanguage,
    selfParticipantId,
    listenerCount,
}: StatusLineProps) {
    let statusText: string;
    let dotClass = "status-dot-idle";

    if (activeSpeaker) {
        dotClass = "status-dot-active";
        if (activeSpeaker.id === selfParticipantId) {
            statusText = "You're speaking";
        } else {
            statusText = `${activeSpeaker.displayName} is speaking`;
        }
    } else if (isProcessingTranslation) {
        dotClass = "status-dot-processing";
        if (listenerCount > 0) {
            statusText = `Translating for ${listenerCount} ${
                listenerCount === 1 ? "listener" : "listeners"
            }`;
        } else {
            statusText = "Translating…";
        }
    } else if (playingTurnLanguage) {
        dotClass = "status-dot-playback";
        const lang = getLanguage(playingTurnLanguage);
        statusText = `Playing in ${lang.nativeName}`;
    } else {
        dotClass = "status-dot-idle";
        statusText = `${connectedCount} ${
            connectedCount === 1 ? "person" : "people"
        } connected`;
    }

    return (
        <div className="room-status-line" aria-live="polite">
            <span className={`status-dot ${dotClass}`} />
            <span className="status-text">{statusText}</span>
        </div>
    );
}
