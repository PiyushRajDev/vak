
import "dotenv/config";

import WebSocket from "ws";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import readline from "node:readline/promises";

const API_KEY = process.env.GNANI_API_KEY_ID;
const ENDPOINT = "wss://api.vachana.ai/stt/v3/stream";

const AUDIO_PATH = resolve(
    process.argv[2] || "outputs/t4-punjabi-16k.wav"
);

const FRAME_BYTES = 1024;
const SAMPLE_RATE = 16000;
const FRAME_DURATION_MS = 32;
const QUIET_WINDOW_MS = 1000;
const MAX_WAIT_MS = 15000;

function parseWav(buffer) {
    if (
        buffer.toString("ascii", 0, 4) !== "RIFF" ||
        buffer.toString("ascii", 8, 12) !== "WAVE"
    ) {
        throw new Error("Invalid WAV file");
    }

    let offset = 12;
    let format;
    let pcm;

    while (offset + 8 <= buffer.length) {
        const name = buffer.toString(
            "ascii",
            offset,
            offset + 4
        );

        const size = buffer.readUInt32LE(offset + 4);
        const start = offset + 8;

        if (name === "fmt ") {
            format = {
                audioFormat: buffer.readUInt16LE(start),
                channels: buffer.readUInt16LE(start + 2),
                sampleRate: buffer.readUInt32LE(start + 4),
                bits: buffer.readUInt16LE(start + 14),
            };
        }

        if (name === "data") {
            pcm = buffer.subarray(
                start,
                start + Math.min(size, buffer.length - start)
            );
            break;
        }

        offset += 8 + size + (size % 2);
    }

    if (!format || !pcm) {
        throw new Error("Missing WAV format or data");
    }

    if (
        format.audioFormat !== 1 ||
        format.channels !== 1 ||
        format.bits !== 16 ||
        format.sampleRate !== SAMPLE_RATE
    ) {
        throw new Error(
            "Expected 16 kHz, mono, 16-bit PCM WAV"
        );
    }

    if (pcm.length % 2 !== 0) {
        throw new Error("Incomplete PCM sample");
    }

    return {
        pcm,
        durationMs: pcm.length / (SAMPLE_RATE * 2) * 1000,
    };
}

const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

function send(ws, data, binary = false) {
    return new Promise((resolve, reject) => {
        ws.send(data, { binary }, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

async function main() {
    if (!API_KEY) {
        throw new Error("GNANI_API_KEY_ID missing");
    }

    const { pcm, durationMs } = parseWav(
        await readFile(AUDIO_PATH)
    );

    const transcripts = [];
    const serverErrors = [];

    let lastEventAt = 0;
    let connectedConfig;

    const ws = new WebSocket(ENDPOINT, {
        handshakeTimeout: 15000,
        headers: {
            "x-api-key-id": API_KEY,
            "model": "prisma-v3.0",
            "language_code": "pa-IN",
            "format": "transcribe",
            "x-sample-rate": String(SAMPLE_RATE),
            "x-vad-threshold": "0.5",
            "x-min-silence-ms": "500",
            "x-min-speech-ms": "100",
            "x-min-segment-ms": "120",
        },
    });

    ws.on("message", (raw) => {
        let message;

        try {
            message = JSON.parse(raw.toString());
        } catch {
            return;
        }

        const receivedAt = performance.now();

        if (message.type === "connected") {
            connectedConfig = message.config;
            console.log("[Prisma] Connected:", message.config);
        }

        if (
            ["speech_start", "processing", "transcript"].includes(
            message.type
            )
        ) {
            lastEventAt = receivedAt;
        }

        if (message.type === "transcript") {
            transcripts.push({
                ...message,
                receivedAt,
            });

            console.log(
                `\n[Segment ${transcripts.length}]`,
                message.text
            );

            console.log(
                "Server latency:",
                message.latency,
                "ms"
            );
        }

        if (message.type === "error") {
            serverErrors.push(message.message);
            console.error("[Prisma error]", message.message);
        }
    });

    try {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(new Error("Connection timeout")),
                15000
            );

            ws.once("open", () => {
                clearTimeout(timeout);
                resolve();
            });

            ws.once("unexpected-response", (req, res) => {
                clearTimeout(timeout);

                let body = "";

                res.on("data", chunk => body += chunk);

                res.on("end", () => {
                    reject(new Error(
                        `HTTP ${res.statusCode}: ${body}`
                    ));
                });
            });

            ws.once("error", error => {
                clearTimeout(timeout);
                reject(error);
            });
        });

        // Wait for Prisma's connected event.
        const connectionDeadline = performance.now() + 10000;

        while (!connectedConfig && performance.now() < connectionDeadline) {
            if (serverErrors.length) {
                throw new Error(serverErrors.join("; "));
            }

            await sleep(50);
        }

        if (!connectedConfig) {
            throw new Error("No Prisma connected message received");
        }

        if (connectedConfig.sample_rate !== SAMPLE_RATE) {
            throw new Error(
                `Sample-rate mismatch: expected ${SAMPLE_RATE}, received ${connectedConfig.sample_rate}`
            );
        }

        const streamStartedAt = performance.now();

        // Send 1024-byte PCM frames at 32 ms intervals.
        let index = 0;

        for (let offset = 0; offset < pcm.length; offset += FRAME_BYTES) {
            const frame = Buffer.alloc(FRAME_BYTES);

            pcm.copy(
                frame,
                0,
                offset,
                Math.min(offset + FRAME_BYTES, pcm.length)
            );

            await send(ws, frame, true);

            index++;

            const nextFrameAt =
                streamStartedAt + index * FRAME_DURATION_MS;

            await sleep(
                Math.max(0, nextFrameAt - performance.now())
            );
        }

        const audioEndAt = performance.now();

        console.log("\nAll audio frames sent.");

        // Explicitly close any remaining open utterance.
        await send(ws, JSON.stringify({
            type: "commit",
        }));

        // Wait until no new transcript arrives for one second.
        // This collects all VAD-separated segments.
        const deadline = performance.now() + MAX_WAIT_MS;

        while (performance.now() < deadline) {
            if (serverErrors.length) {
                throw new Error(serverErrors.join("; "));
            }

            const quietSince = Math.max(
                audioEndAt,
                lastEventAt || audioEndAt
            );

            const quietFor =
                performance.now() - quietSince;

            if (
                transcripts.length > 0 &&
                quietFor >= 1500
            ) {
                break;
            }

            await sleep(50);
        }

        if (!transcripts.length) {
            throw new Error("No transcript segments received");
        }

        if (performance.now() >= deadline) {
            console.warn("Transcript collection reached timeout.");
        }

        const finalTranscript = transcripts
            .map(item => item.text.trim())
            .join(" ");

        const firstReceivedAt = transcripts[0].receivedAt;

        const lastReceivedAt =
            transcripts[transcripts.length - 1].receivedAt;

        const signedPostSpeechLatency =
            lastReceivedAt - audioEndAt;

        const totalRecognizedDuration = transcripts.reduce(
            (sum, item) => sum + (item.audio_duration_ms || 0),
            0
        );

        console.log("\n========== T4 COMPLETE RESULTS ==========");

        console.log({
            segmentCount: transcripts.length,
            segmentTexts: transcripts.map(item => item.text),
            combinedTranscript: finalTranscript,
            detectedLanguages: transcripts.map(
                item => item.detected_language_code
            ),
            totalInputDurationMs: Math.round(durationMs),
            totalRecognizedDurationMs: totalRecognizedDuration,
            averageServerLatencyMs: Math.round(
                transcripts.reduce(
                    (sum, item) => sum + (item.latency || 0),
                    0
                ) / transcripts.length
            ),
            firstTranscriptFromStreamStartMs: Math.round(
                firstReceivedAt - streamStartedAt
            ),
            lastTranscriptFromStreamStartMs: Math.round(
                lastReceivedAt - streamStartedAt
            ),
            transcriptAfterAudioEndMs: Math.max(
                0,
                Math.round(signedPostSpeechLatency)
            ),
            lastTranscriptBeforeAudioEndMs: Math.max(
                0,
                Math.round(-signedPostSpeechLatency)
            ),
        });

        console.log(
            "\nInspect the combined transcript for meaning and completeness."
        );

    } finally {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        await rl.question(
            "\nT4 finished. Press ENTER to close this test: "
        );
    } finally {
        rl.close();
    }
}

main().catch(error => {
    console.error("\nT4 FAILED:", error.message);
    process.exitCode = 1;
});
