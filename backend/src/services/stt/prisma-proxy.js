
import WebSocket, { WebSocketServer } from "ws";

import { SUPPORTED_LANGUAGES } from "../translation/providers/sarvam.js";
import { processVoiceTurn } from "../voice/voice-pipeline.js";

const PRISMA_ENDPOINT = "wss://api.vachana.ai/stt/v3/stream";

function isAllowedOrigin(origin) {
    if (!origin) return true;
    try {
        const { hostname } = new URL(origin);
        return (
            hostname === "localhost" ||
            hostname === "127.0.0.1" ||
            /^10\./.test(hostname) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
            /^192\.168\./.test(hostname)
        );
    } catch {
        return false;
    }
}

const DEFAULT_VOICE =
    process.env.GNANI_TTS_VOICE || "Devansh";

export function attachPrismaProxy(server) {
    const wss = new WebSocketServer({
        noServer: true,
        maxPayload: 1024 * 1024,
    });

    server.on("upgrade", (request, socket, head) => {
        let url;

        try {
            url = new URL(request.url, "http://localhost");
        } catch {
            socket.destroy();
            return;
        }

        if (url.pathname !== "/ws/stt") {
            return;
        }

        const origin = request.headers.origin;

        if (!isAllowedOrigin(origin)) {
            console.warn(`[STT] WebSocket rejected from origin: ${origin}`);
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
        }

        const language =
            url.searchParams.get("language") || "pa-IN";

        const targetLanguage =
            url.searchParams.get("targetLanguage");

        if (!SUPPORTED_LANGUAGES.has(language)) {
            socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
            socket.destroy();
            return;
        }

        // targetLanguage is optional. Without it, this remains
        // an STT-only connection.
        if (
            targetLanguage &&
            !SUPPORTED_LANGUAGES.has(targetLanguage)
        ) {
            socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
            socket.destroy();
            return;
        }

        wss.handleUpgrade(request, socket, head, (client) => {
            wss.emit("connection", client, request, {
                language,
                targetLanguage,
            });
        });
    });

    wss.on("connection", (client, request, config) => {
        const { language, targetLanguage } = config;
        const apiKeyId = process.env.GNANI_API_KEY_ID;

        if (!apiKeyId) {
            client.send(JSON.stringify({
                type: "proxy_error",
                message: "GNANI_API_KEY_ID is not configured",
            }));

            client.close(1011, "Backend configuration error");
            return;
        }

        console.log(
            `[STT] Browser connected; source=${language}; target=${targetLanguage || "STT only"}`
        );

        const upstream = new WebSocket(PRISMA_ENDPOINT, {
            handshakeTimeout: 15000,
            headers: {
                "x-api-key-id": apiKeyId,
                "model": "prisma-v3.0",
                "language_code": language,
                "format": "transcribe",
                "x-sample-rate": "16000",
                "x-vad-threshold": "0.5",
                "x-min-silence-ms": "500",
                "x-min-speech-ms": "100",
                "x-min-segment-ms": "120",
            },
        });

        let providerReady = false;
        let pendingTurns = 0;

        let turnQueue = Promise.resolve();
        let commitGraceTimer = null;

        function sendToBrowser(message) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        }

        function enqueueVoiceTurn(transcriptEvent) {
            if (!targetLanguage || !transcriptEvent.text) {
                return;
            }

            if (commitGraceTimer) {
                clearTimeout(commitGraceTimer);
                commitGraceTimer = null;
            }

            pendingTurns++;

            // Process utterances sequentially on this connection.
            turnQueue = turnQueue.then(async () => {
                try {
                    const sourceLanguage =
                        transcriptEvent.detected_language_code ||
                        language;

                    console.log(
                        `[VOICE] ${sourceLanguage} -> ${targetLanguage}: ${transcriptEvent.text}`
                    );

                    const result = await processVoiceTurn({
                        text: transcriptEvent.text,
                        sourceLanguage,
                        targetLanguage,
                        voice: DEFAULT_VOICE,

                        onEvent: sendToBrowser,

                        onAudioChunk: async (chunk) => {
                            if (
                                client.readyState === WebSocket.OPEN
                            ) {
                                client.send(chunk, {
                                    binary: true,
                                });
                            }
                        },
                    });

                    console.log("[VOICE] Turn completed:", result);

                } catch (error) {
                    console.error(
                        "[VOICE] Pipeline failed:",
                        error.message
                    );

                    sendToBrowser({
                        type: "pipeline_error",
                        message: error.message,
                    });

                } finally {
                    pendingTurns--;

                    if (pendingTurns === 0) {
                        sendToBrowser({
                            type: "pipeline_idle",
                        });
                    }
                }
            });
        }

        upstream.on("open", () => {
            console.log("[STT] Connected to Prisma WebSocket");
        });

        upstream.on("message", (raw, isBinary) => {
            let event = null;

            if (!isBinary) {
                try {
                    event = JSON.parse(raw.toString());
                } catch {
                    // Preserve and forward unrecognized messages.
                }
            }

            if (event?.type === "connected") {
                providerReady = true;
            }

            if (event?.type === "transcript" && event.is_final) {
                if (commitGraceTimer) {
                    clearTimeout(commitGraceTimer);
                    commitGraceTimer = null;
                }

                // Deliver original transcript first.
                sendToBrowser(event);

                // Then translate and synthesize it.
                enqueueVoiceTurn(event);
                return;
            }

            if (client.readyState === WebSocket.OPEN) {
                client.send(raw, { binary: isBinary });
            }
        });

        upstream.on("error", (error) => {
            console.error(
                "[STT] Prisma WebSocket error:",
                error.message
            );

            sendToBrowser({
                type: "proxy_error",
                message: "Could not connect to the speech recognition service",
            });

            if (client.readyState === WebSocket.OPEN) {
                client.close(1011, "Speech provider error");
            }
        });

        upstream.on("close", (code, reason) => {
            console.log(
                `[STT] Prisma connection closed: ${code} ${reason.toString()}`
            );

            providerReady = false;

            sendToBrowser({
                type: "provider_closed",
                code,
                reason: reason.toString(),
            });

            if (client.readyState === WebSocket.OPEN) {
                client.close(1011, "Speech provider closed");
            }
        });

        client.on("message", (data, isBinary) => {
            if (upstream.readyState !== WebSocket.OPEN) {
                sendToBrowser({
                    type: "proxy_error",
                    message: "Speech provider is not connected yet",
                });
                return;
            }

            if (isBinary) {
                if (!providerReady) {
                    sendToBrowser({
                        type: "proxy_error",
                        message: "Prisma has not finished initializing",
                    });
                    return;
                }

                if (data.length !== 1024) {
                    sendToBrowser({
                        type: "proxy_error",
                        message: `Invalid PCM frame size: ${data.length}. Expected 1024 bytes.`,
                    });
                    return;
                }

                upstream.send(data, { binary: true });
                return;
            }

            let control;

            try {
                control = JSON.parse(data.toString());
            } catch {
                sendToBrowser({
                    type: "proxy_error",
                    message: "Invalid control message",
                });
                return;
            }

            if (control.type === "commit") {
                upstream.send(JSON.stringify({
                    type: "commit",
                }));

                // Prisma should emit a final transcript shortly.
                // If there was no speech, still release the client.
                if (commitGraceTimer) {
                    clearTimeout(commitGraceTimer);
                }

                commitGraceTimer = setTimeout(() => {
                    commitGraceTimer = null;

                    if (pendingTurns === 0) {
                        sendToBrowser({
                            type: "pipeline_idle",
                        });
                    }
                }, 3000);

            } else {
                sendToBrowser({
                    type: "proxy_error",
                    message: "Unsupported control message",
                });
            }
        });

        client.on("close", () => {
            console.log("[STT] Browser disconnected");

            providerReady = false;

            if (commitGraceTimer) {
                clearTimeout(commitGraceTimer);
            }

            if (upstream.readyState === WebSocket.OPEN) {
                upstream.close();
            } else if (
                upstream.readyState === WebSocket.CONNECTING
            ) {
                upstream.terminate();
            }
        });

        client.on("error", (error) => {
            console.error(
                "[STT] Browser WebSocket error:",
                error.message
            );

            upstream.terminate();
        });
    });

    console.log("[STT] Prisma WebSocket proxy registered at /ws/stt");
}
