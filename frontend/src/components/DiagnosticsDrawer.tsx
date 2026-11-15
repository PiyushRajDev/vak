import type { ConversationMessage } from "./ConversationFeed";

export type MicInputDevice = {
    deviceId: string;
    label: string;
};

export type MicDiagnostics = {
    inputLabel: string;
    trackState: string;
    trackEnabled: boolean;
    trackMuted: boolean;
    deviceSampleRate?: number;
    deviceChannelCount?: number;
    contextSampleRate?: number;
    inputChannels: number;
    inputRms: number;
    inputPeak: number;
    framesSent: number;
};

type DiagnosticsDrawerProps = {
    isOpen: boolean;
    onClose: () => void;
    roomCode: string;
    participantId: string;
    spokenLanguage: string;
    preferredLanguage: string;
    messages: ConversationMessage[];
    playbackContextState?: string;
    micContextState?: string;
    micDiagnostics: MicDiagnostics;
    micDevices: MicInputDevice[];
    selectedMicDeviceId: string;
    onSelectMicDevice: (deviceId: string) => void;
};

export default function DiagnosticsDrawer({
    isOpen,
    onClose,
    roomCode,
    participantId,
    spokenLanguage,
    preferredLanguage,
    messages,
    playbackContextState = "not-started",
    micContextState = "not-started",
    micDiagnostics,
    micDevices,
    selectedMicDeviceId,
    onSelectMicDevice,
}: DiagnosticsDrawerProps) {
    if (!isOpen) return null;

    // Filter messages with latency measurements
    const measuredMessages = messages.filter(m => m.latencyMs !== undefined);
    const avgLatency = measuredMessages.length > 0
        ? Math.round(
            measuredMessages.reduce((sum, m) => sum + (m.latencyMs || 0), 0) /
            measuredMessages.length
        )
        : null;

    return (
        <div className="diagnostics-backdrop" onClick={onClose} role="presentation">
            <div
                className="diagnostics-drawer"
                role="dialog"
                aria-modal="true"
                aria-label="System Diagnostics"
                onClick={e => e.stopPropagation()}
            >
                <header className="diag-header">
                    <div className="diag-title-row">
                        <span className="diag-icon" aria-hidden="true">⚡</span>
                        <h2 className="diag-title">Vāk Diagnostics</h2>
                    </div>
                    <button
                        type="button"
                        className="diag-close-btn"
                        onClick={onClose}
                        aria-label="Close diagnostics"
                    >
                        ✕
                    </button>
                </header>

                <div className="diag-body">
                    {/* Connection & Audio Info */}
                    <section className="diag-section">
                        <h3 className="diag-section-title">Session State</h3>
                        <div className="diag-grid">
                            <div className="diag-stat">
                                <span className="stat-label">Room Code</span>
                                <code className="stat-value">{roomCode}</code>
                            </div>
                            <div className="diag-stat">
                                <span className="stat-label">Participant ID</span>
                                <code className="stat-value">{participantId.slice(0, 10)}…</code>
                            </div>
                            <div className="diag-stat">
                                <span className="stat-label">Spoken Lang</span>
                                <span className="stat-value">{spokenLanguage}</span>
                            </div>
                            <div className="diag-stat">
                                <span className="stat-label">Listening Lang</span>
                                <span className="stat-value">{preferredLanguage}</span>
                            </div>
                            <div className="diag-stat">
                                <span className="stat-label">Mic Context</span>
                                <span className="stat-value stat-ok">{micContextState}</span>
                            </div>
                            <div className="diag-stat">
                                <span className="stat-label">Playback Context</span>
                                <span className="stat-value">{playbackContextState}</span>
                            </div>
                            <div className="diag-stat">
                                <span className="stat-label">Microphone Input</span>
                                <select
                                    id="mic-input-device"
                                    className="diag-mic-device-select"
                                    value={selectedMicDeviceId}
                                    onChange={event => onSelectMicDevice(event.target.value)}
                                >
                                    <option value="">System default microphone</option>
                                    {micDevices.map(device => (
                                        <option key={device.deviceId} value={device.deviceId}>
                                            {device.label}
                                        </option>
                                    ))}
                                </select>
                                <span className="stat-value">{micDiagnostics.inputLabel}</span>
                            </div>
                            <div className="diag-stat">
                                <span className="stat-label">Mic Track</span>
                                <span className="stat-value">
                                    {micDiagnostics.trackState}
                                    {" · "}
                                    {micDiagnostics.trackEnabled ? "enabled" : "disabled"}
                                    {" · "}
                                    {micDiagnostics.trackMuted ? "muted" : "unmuted"}
                                </span>
                            </div>
                            <div className="diag-stat">
                                <span className="stat-label">Input / Context Rate</span>
                                <span className="stat-value">
                                    {micDiagnostics.deviceSampleRate ?? "?"}
                                    {" / "}
                                    {micDiagnostics.contextSampleRate ?? "?"} Hz
                                </span>
                            </div>
                            <div className="diag-stat">
                                <span className="stat-label">Input Channels</span>
                                <span className="stat-value">
                                    {micDiagnostics.deviceChannelCount ?? micDiagnostics.inputChannels}
                                </span>
                            </div>
                            <div className="diag-stat">
                                <span className="stat-label">Mic Level (RMS)</span>
                                <span className="stat-value">
                                    {micDiagnostics.inputRms > 0
                                        ? (20 * Math.log10(micDiagnostics.inputRms)).toFixed(1) + " dBFS"
                                        : "No signal"}
                                    {" · peak "}
                                    {micDiagnostics.inputPeak.toFixed(3)}
                                </span>
                            </div>
                            <div className="diag-stat">
                                <span className="stat-label">PCM Frames Sent</span>
                                <span className="stat-value">{micDiagnostics.framesSent}</span>
                            </div>
                            {avgLatency !== null && (
                                <div className="diag-stat">
                                    <span className="stat-label">Avg Pipeline Latency</span>
                                    <span className="stat-value stat-accent">{avgLatency} ms</span>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Per-utterance pipeline timings */}
                    <section className="diag-section">
                        <h3 className="diag-section-title">
                            Recent Pipeline Utterances ({messages.length})
                        </h3>

                        {messages.length === 0 ? (
                            <p className="diag-empty">No utterances recorded yet in this session.</p>
                        ) : (
                            <div className="diag-utterance-list">
                                {messages.slice(-10).reverse().map(msg => (
                                    <div key={msg.id} className="diag-utterance-item">
                                        <div className="diag-utt-meta">
                                            <span className="diag-utt-speaker">{msg.speakerName}</span>
                                            <span className="diag-utt-langs">
                                                {msg.sourceLanguage} → {msg.targetLanguage || "all"}
                                            </span>
                                            {msg.latencyMs !== undefined && (
                                                <span className="diag-utt-latency">
                                                    {msg.latencyMs} ms
                                                </span>
                                            )}
                                        </div>
                                        <div className="diag-utt-text">
                                            <span className="diag-text-orig">{msg.originalText}</span>
                                            {msg.translatedText && (
                                                <span className="diag-text-trans">↳ {msg.translatedText}</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
