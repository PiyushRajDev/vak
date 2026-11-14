import { getLanguage } from "../languages";

type StatusLineProps = {
    activeSpeaker: { id: string; displayName: string } | null;
    isProcessingTranslation: boolean;
    playingTurnLanguage?: string | null;
    selfParticipantId: string;
    listenerCount: number;
};

export default function StatusLine({
    activeSpeaker,
    isProcessingTranslation,
    playingTurnLanguage,
    selfParticipantId,
    listenerCount,
}: StatusLineProps) {
    let statusText = "";
    let dotClass = "";

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
    }

    if (!statusText) {
        return null;
    }

    return (
        <div className="stage-status-inline" aria-live="polite">
            <span className={`status-dot ${dotClass}`} aria-hidden="true" />
            <span className="status-text">{statusText}</span>
        </div>
    );
}
