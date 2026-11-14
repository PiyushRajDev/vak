import { useState } from "react";
import { LANGUAGES, getLanguage } from "../languages";

type ControlDockProps = {
    micState: string;
    isMuted: boolean;
    micError: string | null;
    isStarting: boolean;
    isDisabled: boolean;
    onToggleMic: () => void;
    onRetryMic: () => void;
    spokenLanguage: string;
    preferredLanguage: string;
    onChangePreferredLanguage?: (code: string) => void;
    showRail: boolean;
    onToggleRail: () => void;
    onOpenDiagnostics: () => void;
    onLeaveRoom: () => void;
};

export default function ControlDock({
    micState,
    isMuted,
    micError,
    isStarting,
    isDisabled,
    onToggleMic,
    onRetryMic,
    spokenLanguage,
    preferredLanguage,
    onChangePreferredLanguage,
    showRail,
    onToggleRail,
    onOpenDiagnostics,
    onLeaveRoom,
}: ControlDockProps) {
    const spoken = getLanguage(spokenLanguage);
    const preferred = getLanguage(preferredLanguage);
    const [langPickerOpen, setLangPickerOpen] = useState(false);

    const isSpeaking = micState === "You're speaking";
    const isPlaying = micState.startsWith("Playing in");

    return (
        <nav className="room-control-dock" role="toolbar" aria-label="Room Controls">
            {/* 1. Mic Button / Mic Blocked Pill */}
            {micError ? (
                <div className="dock-mic-error-pill">
                    <span className="dock-error-text">Mic blocked</span>
                    <button
                        type="button"
                        className="btn btn-primary btn-sm dock-retry-btn"
                        onClick={onRetryMic}
                    >
                        Try again
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    className={`dock-btn dock-btn-mic ${
                        isMuted ? "dock-mic-muted" : "dock-mic-active"
                    } ${isSpeaking ? "dock-mic-speaking" : ""} ${
                        isPlaying ? "dock-mic-playing" : ""
                    }`}
                    onClick={onToggleMic}
                    disabled={isDisabled || isStarting}
                    aria-label={isMuted ? "Unmute microphone (shortcut: M)" : "Mute microphone (shortcut: M)"}
                    title={isMuted ? "Unmute microphone (M)" : "Mute microphone (M)"}
                >
                    <span className="dock-mic-icon-wrap" aria-hidden="true">
                        {isMuted ? (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="1" y1="1" x2="23" y2="23" />
                                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                                <line x1="12" y1="19" x2="12" y2="23" />
                                <line x1="8" y1="23" x2="16" y2="23" />
                            </svg>
                        ) : (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <line x1="12" y1="19" x2="12" y2="23" />
                                <line x1="8" y1="23" x2="16" y2="23" />
                            </svg>
                        )}
                    </span>
                    <span className="dock-mic-label">{micState}</span>
                    <span className="dock-key-hint" aria-hidden="true">M</span>
                </button>
            )}

            {/* 2. Language Pair Chip with interactive listening language selection */}
            <div className="dock-lang-pair-wrapper">
                <button
                    type="button"
                    className="dock-lang-pair-chip"
                    onClick={() => {
                        if (onChangePreferredLanguage) {
                            setLangPickerOpen(prev => !prev);
                        }
                    }}
                    title={`You speak ${spoken.englishName}, hearing translated into ${preferred.englishName}. ${onChangePreferredLanguage ? "Click to change hearing language" : ""}`}
                    aria-haspopup="listbox"
                    aria-expanded={langPickerOpen}
                >
                    <span className="pair-native">{spoken.nativeName}</span>
                    <span className="pair-arrow" aria-hidden="true">→</span>
                    <span className="pair-native pair-preferred-highlight">{preferred.nativeName}</span>
                    {onChangePreferredLanguage && (
                        <span className="pair-edit-icon" aria-hidden="true">▾</span>
                    )}
                </button>

                {langPickerOpen && onChangePreferredLanguage && (
                    <div className="dock-lang-dropdown" role="listbox">
                        <div className="dock-lang-dropdown-header">Hear in:</div>
                        <div className="dock-lang-dropdown-list">
                            {LANGUAGES.map(lang => (
                                <button
                                    key={lang.code}
                                    type="button"
                                    className={`dock-lang-opt ${lang.code === preferredLanguage ? "selected" : ""}`}
                                    onClick={() => {
                                        onChangePreferredLanguage(lang.code);
                                        setLangPickerOpen(false);
                                    }}
                                    role="option"
                                    aria-selected={lang.code === preferredLanguage}
                                >
                                    <span className="opt-native">{lang.nativeName}</span>
                                    <span className="opt-en">{lang.englishName}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* 3. Conversation Toggle */}
            <button
                type="button"
                className={`dock-btn dock-btn-icon ${showRail ? "dock-btn-selected" : ""}`}
                onClick={onToggleRail}
                aria-label={showRail ? "Hide conversation (shortcut: C)" : "Show conversation (shortcut: C)"}
                title="Conversation (C)"
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span className="dock-key-hint" aria-hidden="true">C</span>
            </button>

            {/* 4. Diagnostics "i" Button */}
            <button
                type="button"
                className="dock-btn dock-btn-icon dock-btn-info"
                onClick={onOpenDiagnostics}
                aria-label="Open diagnostics (shortcut: D)"
                title="Diagnostics (D)"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
            </button>

            <div className="dock-divider" aria-hidden="true" />

            {/* 5. Leave Button (Neutral/ghost with phone-down that turns solid red on hover) */}
            <button
                type="button"
                className="dock-btn dock-btn-leave"
                onClick={onLeaveRoom}
                aria-label="Leave room"
                title="Leave room"
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
                    <line x1="23" y1="1" x2="1" y2="23" />
                </svg>
                <span className="dock-leave-label">Leave</span>
            </button>
        </nav>
    );
}

