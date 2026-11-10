import { useState } from "react";
import { getLanguage } from "../languages";
import type { RoomSession } from "./RoomLobby";

type ReadyGateProps = {
    roomSession: RoomSession;
    onStart: (stream: MediaStream, playbackContext: AudioContext) => void;
    onCancel?: () => void;
};

export default function ReadyGate({
    roomSession,
    onStart,
    onCancel,
}: ReadyGateProps) {
    const [status, setStatus] = useState<"idle" | "requesting" | "blocked">("idle");
    const [errorMessage, setErrorMessage] = useState("");

    const spoken = getLanguage(roomSession.spokenLanguage);
    const listening = getLanguage(roomSession.preferredLanguage);

    const handleStart = async () => {
        setStatus("requesting");
        setErrorMessage("");

        let playbackContext: AudioContext | null = null;
        let stream: MediaStream | null = null;

        try {
            // 1. Unlock audio playback via user gesture
            const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            playbackContext = new AudioCtx({ sampleRate: 48000 });
            if (playbackContext.state === "suspended") {
                await playbackContext.resume();
            }

            // Silent buffer test to ensure context is unlocked
            const testBuffer = playbackContext.createBuffer(1, 1, 48000);
            const testSource = playbackContext.createBufferSource();
            testSource.buffer = testBuffer;
            testSource.connect(playbackContext.destination);
            testSource.start(0);

            // 2. Request microphone permission
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error("Microphone access is not supported by your browser.");
            }

            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
                video: false,
            });

            // Both succeeded! Enter the room.
            onStart(stream, playbackContext);
        } catch (err: unknown) {
            console.error("Audio/Mic initialization error:", err);
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
            }
            if (playbackContext && playbackContext.state !== "closed") {
                void playbackContext.close();
            }

            const isPermissionDenied =
                err instanceof DOMException &&
                (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");

            if (isPermissionDenied) {
                setStatus("blocked");
                setErrorMessage("Mic blocked. Check your browser microphone permission.");
            } else {
                setStatus("blocked");
                setErrorMessage("Mic blocked. Check your browser microphone permission.");
            }
        }
    };

    return (
        <main className="app gate-app">
            <header className="brand-header">
                <div className="brand">
                    <span className="brand-indic">वाक्</span>
                    <span className="brand-latin">VĀK</span>
                </div>
            </header>

            <section className="panel gate-panel">
                <div className="gate-ready-badge">You're ready</div>

                <div className="gate-language-pair">
                    <div className="gate-lang-block">
                        <span className="gate-lang-label">Speaking</span>
                        <div className="gate-lang-value">
                            <span className="gate-lang-native">{spoken.nativeName}</span>
                            <span className="gate-lang-en">{spoken.englishName}</span>
                        </div>
                    </div>

                    <div className="gate-arrow">→</div>

                    <div className="gate-lang-block">
                        <span className="gate-lang-label">Listening</span>
                        <div className="gate-lang-value">
                            <span className="gate-lang-native">{listening.nativeName}</span>
                            <span className="gate-lang-en">{listening.englishName}</span>
                        </div>
                    </div>
                </div>

                <p className="gate-instruction">
                    Speak naturally. Vāk will handle the rest.
                </p>

                <div className="gate-headphone-tip">
                    <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10a9 9 0 0 1 18 0v9a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
                    </svg>
                    <span>Headphones recommended for the best experience.</span>
                </div>

                {status === "blocked" && (
                    <div className="gate-error-banner" role="alert">
                        <p>{errorMessage}</p>
                    </div>
                )}

                <div className="gate-actions">
                    {status === "blocked" ? (
                        <button
                            type="button"
                            className="btn btn-primary btn-large"
                            onClick={handleStart}
                        >
                            Try again
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="btn btn-primary btn-large"
                            onClick={handleStart}
                            disabled={status === "requesting"}
                        >
                            {status === "requesting" ? "Setting up..." : "Start"}
                        </button>
                    )}

                    {onCancel && (
                        <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={onCancel}
                            disabled={status === "requesting"}
                        >
                            Back
                        </button>
                    )}
                </div>
            </section>
        </main>
    );
}
