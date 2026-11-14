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
                const isInsecure =
                    window.location.protocol !== "https:" &&
                    window.location.hostname !== "localhost" &&
                    window.location.hostname !== "127.0.0.1";

                if (isInsecure) {
                    throw new Error(
                        "Microphone access requires HTTPS. You are accessing this app over an insecure connection (" +
                        window.location.protocol + "//" + window.location.hostname +
                        "). Please use HTTPS or access via localhost."
                    );
                }

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

            // Both succeeded! Start muted by default.
            stream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });

            onStart(stream, playbackContext);
        } catch (err: unknown) {
            console.error("Audio/Mic initialization error:", err);
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
            }
            if (playbackContext && playbackContext.state !== "closed") {
                void playbackContext.close();
            }

            let msg = "Could not access microphone. Please try again.";

            if (err instanceof DOMException) {
                if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
                    msg = "Microphone permission denied. Click the camera/mic icon in your browser address bar and allow access, then try again.";
                } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
                    msg = "No microphone found. Please connect a microphone and try again.";
                } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
                    msg = "Microphone is in use by another application. Close other apps using the mic and try again.";
                } else if (err.name === "OverconstrainedError") {
                    msg = "Microphone does not meet audio requirements. Try a different device.";
                } else if (err.name === "SecurityError" || err.name === "TypeError") {
                    msg = "Microphone access requires a secure connection (HTTPS or localhost). Please use a secure URL.";
                } else {
                    msg = `Microphone error: ${err.name}. Check browser permissions and try again.`;
                }
            } else if (err instanceof TypeError) {
                msg = "Microphone access requires a secure connection (HTTPS or localhost). Please use a secure URL.";
            } else if (err instanceof Error) {
                msg = err.message;
            }

            setStatus("blocked");
            setErrorMessage(msg);
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

                <div className="gate-language-pair" style={{ justifyContent: "center" }}>
                    <div className="gate-lang-block" style={{ minWidth: "220px" }}>
                        <span className="gate-lang-label">Language</span>
                        <div className="gate-lang-value">
                            <span className="gate-lang-native">{spoken.nativeName}</span>
                            <span className="gate-lang-en">{spoken.englishName}</span>
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
