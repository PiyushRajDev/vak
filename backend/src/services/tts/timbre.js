
import WebSocket from "ws";
import { performance } from "node:perf_hooks";

const ENDPOINT = "wss://api.vachana.ai/api/v1/tts";

const SAMPLE_RATE = 48000;
const DEFAULT_MODEL =
    process.env.GNANI_TTS_MODEL || "timbre-v3.0";

export async function synthesizeSpeech({
    text,
    language,
    voice,
    model = DEFAULT_MODEL,
    speed = 1.0,
    onAudioChunk,
    collectAudio = true,
    timeoutMs = 60000,
}) {
    const apiKey = process.env.GNANI_API_KEY_ID;

    if (!apiKey) {
        throw new Error("GNANI_API_KEY_ID is not configured");
    }

    if (typeof text !== "string" || !text.trim()) {
        throw new Error("TTS text cannot be empty");
    }

    if (!language || !voice) {
        throw new Error("Language and voice are required");
    }

    if (!Number.isFinite(speed) || speed <= 0) {
        throw new Error("Speed must be a positive number");
    }

    if (!collectAudio && typeof onAudioChunk !== "function") {
        throw new Error(
            "Provide onAudioChunk when collectAudio is disabled"
        );
    }

    const payload = {
        text,
        voice,
        model,
        language,
        speed,
        audio_config: {
            sample_rate: SAMPLE_RATE,
            num_channels: 1,
            sample_width: 2,
            encoding: "linear_pcm",
            container: "raw",
        },
    };

    const ws = new WebSocket(ENDPOINT, {
        handshakeTimeout: 15000,
        headers: {
            "X-API-Key-ID": apiKey,
        },
    });

    const startedAt = performance.now();

    const chunks = [];

    let connectedAt = null;
    let requestSentAt = null;
    let firstChunkAt = null;

    let requestId = null;
    let chunkCount = 0;
    let totalAudioBytes = 0;

    // Preserve chunk order even if the consumer is asynchronous.
    let chunkQueue = Promise.resolve();

    try {
        const result = await new Promise((resolve, reject) => {
            let finished = false;

            const timer = setTimeout(() => {
                fail(new Error("Timbre synthesis timed out"));
            }, timeoutMs);

            function fail(error) {
                if (finished) return;

                finished = true;
                clearTimeout(timer);
                reject(error);

                if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                } else if (
                    ws.readyState === WebSocket.CONNECTING
                ) {
                    ws.terminate();
                }
            }

            async function complete() {
                if (finished) return;

                try {
                    await chunkQueue;

                    if (finished) return;

                    finished = true;
                    clearTimeout(timer);

                    const pcm = collectAudio
                        ? Buffer.concat(chunks)
                        : null;

                    const completedAt = performance.now();

                    resolve({
                        requestId,
                        pcm,
                        chunkCount,
                        audioBytes: totalAudioBytes,

                        audioDurationSeconds:
                            totalAudioBytes /
                            (SAMPLE_RATE * 2),

                        connectMs: Math.round(
                            connectedAt - startedAt
                        ),

                        firstChunkMs: firstChunkAt
                            ? Math.round(
                                firstChunkAt - requestSentAt
                            )
                            : null,

                        totalMs: Math.round(
                            completedAt - startedAt
                        ),

                        sampleRate: SAMPLE_RATE,
                        channels: 1,
                        encoding: "pcm_s16le",
                    });
                } catch (error) {
                    fail(error);
                }
            }

            ws.on("open", () => {
                connectedAt = performance.now();
                requestSentAt = performance.now();

                ws.send(
                    JSON.stringify(payload),
                    error => {
                        if (error) fail(error);
                    }
                );
            });

            // Listener is attached before the synthesis request
            // is sent, avoiding the race in the original test.
            ws.on("message", (raw, isBinary) => {
                if (isBinary) {
                    fail(
                        new Error(
                            "Unexpected binary response from Timbre"
                        )
                    );
                    return;
                }

                let message;

                try {
                    message = JSON.parse(raw.toString());
                } catch {
                    fail(
                        new Error("Invalid JSON response from Timbre")
                    );
                    return;
                }

                if (message.type === "start") {
                    requestId = message.request_id || null;
                    return;
                }

                if (message.type === "audio") {
                    const encodedAudio = message.data?.audio;

                    if (
                        typeof encodedAudio !== "string" ||
                        !encodedAudio.length
                    ) {
                        fail(
                            new Error("Timbre returned an empty audio chunk")
                        );
                        return;
                    }

                    const audio = Buffer.from(
                        encodedAudio,
                        "base64"
                    );

                    if (audio.length === 0) {
                        fail(
                            new Error("Could not decode audio chunk")
                        );
                        return;
                    }

                    chunkCount++;
                    totalAudioBytes += audio.length;

                    if (firstChunkAt === null) {
                        firstChunkAt = performance.now();
                    }

                    if (collectAudio) {
                        chunks.push(audio);
                    }

                    if (onAudioChunk) {
                        const metadata = {
                            chunkNumber: chunkCount,
                            providerChunkIndex:
                                message.data.chunk_index ?? null,
                            requestId,
                        };

                        chunkQueue = chunkQueue.then(() =>
                            onAudioChunk(audio, metadata)
                        );
                    }

                    return;
                }

                if (message.type === "complete") {
                    void complete();
                    return;
                }

                if (message.type === "error") {
                    fail(
                        new Error(
                            message.message || "Timbre synthesis failed"
                        )
                    );
                }
            });

            ws.on("error", error => {
                fail(error);
            });

            ws.on("close", (code, reason) => {
                if (!finished) {
                    fail(
                        new Error(
                            `Timbre closed before completion: ${code} ${reason.toString()}`
                        )
                    );
                }
            });
        });

        if (collectAudio && result.audioBytes === 0) {
            throw new Error("Timbre completed without audio");
        }

        return result;

    } finally {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
            ws.terminate();
        }
    }
}
