
import "dotenv/config";

import WebSocket from "ws";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const API_KEY = process.env.GNANI_API_KEY_ID;

const ENDPOINT = "wss://api.vachana.ai/api/v1/tts";

const SAMPLE = {
    text: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਵਾਕ ਵਿੱਚ ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ।",
    voice: "Devansh",
    model: "timbre-v3.0",
    language: "pa-IN",
    speed: 1.0,

    audio_config: {
        sample_rate: 48000,
        num_channels: 1,
        sample_width: 2,
        encoding: "linear_pcm",
        container: "raw",
    },
};

function createWavHeader(dataSize) {
    const header = Buffer.alloc(44);

    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);

    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(48000, 24);
    header.writeUInt32LE(96000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);

    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);

    return header;
}

async function main() {
    if (!API_KEY) {
        throw new Error("GNANI_API_KEY_ID missing");
    }

    const ws = new WebSocket(ENDPOINT, {
        handshakeTimeout: 15000,
        headers: {
            "X-API-Key-ID": API_KEY,
        },
    });

    const chunks = [];

    let firstChunkMs = null;
    let chunkCount = 0;
    let totalAudioBytes = 0;

    const startedAt = performance.now();

    
await new Promise((resolve, reject) => {
    const timer = setTimeout(
        () => reject(new Error("WebSocket connection timeout")),
        15000
    );

    ws.once("open", () => {
        clearTimeout(timer);

        console.log("Timbre WebSocket connected.");

        console.log("Sending synthesis request...");

        ws.send(JSON.stringify(SAMPLE));

        // Critical: allow execution to continue
        // so the message listener can be attached.
        resolve();
    });

    ws.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
    });
});

    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error("Synthesis timeout")),
                120000
            );

            ws.on("message", (raw) => {
                let message;

                try {
                    message = JSON.parse(raw.toString());
                } catch {
                    reject(new Error("Invalid JSON response"));
                    return;
                }

                if (message.type === "start") {
                    console.log("Synthesis started:", message.request_id);
                }

                if (message.type === "audio") {
                    const audio = Buffer.from(
                        message.data.audio,
                        "base64"
                    );

                    if (firstChunkMs === null) {
                        firstChunkMs = Math.round(
                            performance.now() - startedAt
                        );

                        console.log(
                            `First audio chunk received: ${firstChunkMs} ms`
                        );
                    }

                    chunks.push(audio);
                    chunkCount++;
                    totalAudioBytes += audio.length;

                    console.log(
                        `Chunk ${message.data.chunk_index}: ${audio.length} bytes`
                    );
                }

                if (message.type === "complete") {
                    clearTimeout(timer);
                    resolve();
                }

                if (message.type === "error") {
                    clearTimeout(timer);

                    reject(
                        new Error(message.message)
                    );
                }
            });

            ws.on("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });

        const totalMs = Math.round(
            performance.now() - startedAt
        );

        const pcm = Buffer.concat(chunks);

        if (pcm.length === 0) {
            throw new Error("No audio chunks received");
        }

        const wav = Buffer.concat([
            createWavHeader(pcm.length),
            pcm,
        ]);

        await mkdir("outputs", { recursive: true });

        await writeFile(
            "outputs/t2-realtime-punjabi.wav",
            wav
        );

        console.log("\n========== REALTIME TTS RESULTS ==========");

        console.table([{
            firstAudioChunkMs: firstChunkMs,
            totalGenerationMs: totalMs,
            chunkCount,
            audioBytes: totalAudioBytes,
            audioDurationSeconds: (
                totalAudioBytes / 96000
            ).toFixed(2),
        }]);

        console.log(
            "Saved: outputs/t2-realtime-punjabi.wav"
        );

    } finally {
        ws.close();
    }
}

main().catch((error) => {
    console.error("REALTIME TTS FAILED:", error.message);
    process.exitCode = 1;
});
