import { useEffect, useRef } from "react";
import { getLanguage } from "../languages";

export type ConversationMessage = {
    id: string;
    turnId?: string;
    speakerId: string;
    speakerName: string;
    sourceLanguage: string;
    targetLanguage?: string;
    isSelf: boolean;
    originalText: string;
    translatedText?: string;
    isTranslating?: boolean;
    timestamp: number;
    latencyMs?: number;
};

export type ParticipantInfo = {
    id: string;
    displayName: string;
    spokenLanguage: string;
    preferredLanguage: string;
    isMuted?: boolean;
    connected?: boolean;
};

type ConversationFeedProps = {
    messages: ConversationMessage[];
    playingTurnId: string | null;
    participants: ParticipantInfo[];
    selfParticipantId: string;
};

export default function ConversationFeed({
    messages,
    playingTurnId,
    participants,
    selfParticipantId,
}: ConversationFeedProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const userScrolledUpRef = useRef(false);

    // Compute distinct target language names of other listeners for self messages
    const otherListeners = participants.filter(p => p.id !== selfParticipantId);
    const targetLangNames = Array.from(
        new Set(
            otherListeners
                .map(p => getLanguage(p.preferredLanguage).englishName)
                .filter(name => Boolean(name && name !== "Unknown"))
        )
    );
    const targetLangsSummary = targetLangNames.length > 0 ? targetLangNames.join(", ") : "";

    const handleScroll = () => {
        const el = containerRef.current;
        if (!el) return;
        // User is considered scrolled up if more than 48px from bottom
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        userScrolledUpRef.current = distanceFromBottom > 48;
    };

    useEffect(() => {
        if (!userScrolledUpRef.current && containerRef.current) {
            containerRef.current.scrollTo({
                top: containerRef.current.scrollHeight,
                behavior: "smooth",
            });
        }
    }, [messages, playingTurnId]);

    return (
        <section
            className="conversation-feed"
            ref={containerRef}
            onScroll={handleScroll}
            aria-label="Conversation transcript"
        >
            {messages.length === 0 ? (
                <div className="conversation-empty">
                    <p className="conversation-empty-title">No speech yet</p>
                    <p className="conversation-empty-hint">
                        Speak in your language. Everyone hears in theirs.
                    </p>
                </div>
            ) : (
                <div className="conversation-list">
                    {messages.map(msg => {
                        const isSelf = msg.speakerId === selfParticipantId;
                        const speakerLang = getLanguage(msg.sourceLanguage);
                        const isPlaying = Boolean(
                            msg.turnId && playingTurnId && msg.turnId === playingTurnId
                        );

                        return (
                            <article
                                key={msg.id}
                                className={`message-card ${
                                    isSelf ? "message-card-self" : "message-card-other"
                                } ${isPlaying ? "message-card-playing" : ""}`}
                            >
                                <header className="message-header">
                                    <div className="message-speaker-meta">
                                        <span className="message-speaker-name">
                                            {isSelf ? "You" : msg.speakerName}
                                        </span>
                                        <span className="lang-tag">
                                            <span className="lang-native">
                                                {speakerLang.nativeName}
                                            </span>
                                            <span className="lang-en">
                                                {speakerLang.englishName}
                                            </span>
                                        </span>
                                    </div>

                                    {isPlaying && (
                                        <span className="playing-indicator" aria-live="polite">
                                            <span className="playing-dot" />
                                            <span>Playing translation</span>
                                        </span>
                                    )}
                                </header>

                                {isSelf ? (
                                    <div className="message-content">
                                        <p className="message-primary-text">
                                            {msg.originalText}
                                        </p>
                                        {targetLangsSummary && (
                                            <p className="message-targets">
                                                → {targetLangsSummary}
                                            </p>
                                        )}
                                    </div>
                                ) : (
                                    <div className="message-content">
                                        <p className="message-primary-text">
                                            {msg.translatedText || (
                                                <span className="translating-indicator">
                                                    Translating…
                                                </span>
                                            )}
                                        </p>
                                        <p className="message-secondary-text">
                                            {msg.originalText}
                                        </p>
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
