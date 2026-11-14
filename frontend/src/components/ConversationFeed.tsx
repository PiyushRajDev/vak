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
    onClose?: () => void;
};

export default function ConversationFeed({
    messages,
    playingTurnId,
    participants,
    selfParticipantId,
    onClose,
}: ConversationFeedProps) {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
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
        const el = scrollContainerRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        userScrolledUpRef.current = distanceFromBottom > 48;
    };

    useEffect(() => {
        if (!userScrolledUpRef.current && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({
                top: scrollContainerRef.current.scrollHeight,
                behavior: "smooth",
            });
        }
    }, [messages, playingTurnId]);

    return (
        <aside className="conversation-rail" aria-label="Live conversation stream">
            {/* Rail Header */}
            <header className="rail-header">
                <div className="rail-title-row">
                    <h2 className="rail-title">Conversation</h2>
                    <span className="rail-badge">{messages.length}</span>
                </div>

                {onClose && (
                    <button
                        type="button"
                        className="rail-close-btn"
                        onClick={onClose}
                        aria-label="Close conversation panel"
                        title="Close panel (Esc or C)"
                    >
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
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                )}
            </header>

            {/* Scrollable messages stream */}
            <div
                className="rail-messages-body"
                ref={scrollContainerRef}
                onScroll={handleScroll}
                aria-live="polite"
            >
                {messages.length === 0 ? (
                    <div className="conversation-empty">
                        <div className="empty-icon-wrap" aria-hidden="true">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                        </div>
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
                                                <span className="playing-dot" aria-hidden="true" />
                                                <span>Playing translation</span>
                                            </span>
                                        )}
                                    </header>

                                    {isSelf ? (
                                        <div className="message-content">
                                            {/* My own message shows my original as primary */}
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
                                            {/* Other speaker's message shows text in MY listening language as large primary */}
                                            <p className="message-primary-text">
                                                {msg.translatedText || (
                                                    <span className="translating-indicator">
                                                        Translating…
                                                    </span>
                                                )}
                                            </p>
                                            {/* Original in small muted text below */}
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
            </div>
        </aside>
    );
}
