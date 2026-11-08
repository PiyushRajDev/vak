
import "dotenv/config";

import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import WebSocket from "ws";

const WAV_PATH = "outputs/t4-punjabi-16k.wav";

const PROXY_URL =
    "ws://localhost:8000/ws/stt?language=pa-IN&targetLanguage=ta-IN";

const FRAME_BYTES = 1024;
const FRAME_INTERVAL_MS = 32;
const SAMPLE_RATE = 48000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function extractPcmFromWav(buffer) {
    if (
        buffer.toString("ascii", 0, 4) !== "RIFF" ||
        buffer.toString("ascii", 8, 12) !== "WAVE"
    ) {
        throw new Error("Invalid WAV file");
    }

    let format = null;
    let pcmData = null;
    let offset = 12;

    while (offset + 8 <= buffer.length) {
        const chunkId = buffer.toString("ascii", offset, offset + 4);
        const declaredSize = buffer.readUInt32LE(offset + 4);
        const start = offset + 8;
        const end = Math.min(start + declaredSize, buffer.length);

        if (chunkId === "fmt ") {
            format = {
                audioFormat: buffer.readUInt16LE(start),
                channels: buffer.readUInt16LE(start + 2),
                sampleRate: buffer.readUInt32LE(start + 4),
                bitsPerSample: buffer.readUInt16LE(start + 14),
            };
        }

        if (chunkId === "data") {
            pcmData = buffer.subarray(start, end);
            break;
        }

        offset = start + declaredSize + (declaredSize % 2);
    }

    if (!format || !pcmData) {
        throw new Error("WAV format or data chunk missing");
    }

    if (
        format.audioFormat !== 1 ||
        format.channels !== 1 ||
        format.sampleRate !== 16000 ||
        format.bitsPerSample !== 16
    ) {
        throw new Error(
            `Expected mono 16 kHz PCM16, received ${JSON.stringify(format)}`
        );
    }

    return pcmData;
}

function createWavHeader(dataSize) {
    const header = Buffer.alloc(44);

    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);

    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);

    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);

    return header;
}

async function main() {
    const wav = fs.readFileSync(WAV_PATH);
    const pcm = extractPcmFromWav(wav);

    console.log("Input audio duration:", (pcm.length / 32000).toFixed(2), "s");

    const ws = new WebSocket(PROXY_URL);
    ws.binaryType = "nodebuffer";

    const audioChunks = [];
    const translations = [];

    let pipelineError = null;

    let readyResolve;
    let readyReject;
    let idleResolve;

    const readyPromise = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });

    const idlePromise = new Promise(resolve => {
        idleResolve = resolve;
    });

    ws.on("message", (raw, isBinary) => {
        if (isBinary) {
            const chunk = Buffer.from(raw);
            audioChunks.push(chunk);

            if (audioChunks.length === 1) {
                console.log("First translated audio chunk:", chunk.length, "bytes");
            }

            return;
        }

        let message;

        try {
            message = JSON.parse(raw.toString());
        } catch {
            console.log("[NON-JSON]", raw.toString());
            return;
        }

        if (message.type === "connected") {
            console.log("[PRISMA READY]");
            readyResolve();
            return;
        }

        if (message.type === "transcript") {
            console.log("[TRANSCRIPT]", message.text);
            return;
        }

        if (message.type === "translation") {
            translations.push(message);
            console.log("[TRANSLATION]", message.translatedText);
            return;
        }

        if (message.type === "tts_started") {
            console.log("[TTS STARTED]", message);
            return;
        }

        if (message.type === "tts_complete") {
            console.log("[TTS COMPLETE]", message);
            return;
        }

        if (message.type === "pipeline_error") {
            pipelineError = message.message;
            console.error("[PIPELINE ERROR]", message.message);
            return;
        }

        if (message.type === "pipeline_idle") {
            console.log("[PIPELINE IDLE]");
            idleResolve();
            return;
        }

        if (message.type === "proxy_error") {
            pipelineError = message.message;
            readyReject(new Error(message.message));
            return;
        }

        console.log("[EVENT]", message);
    });

    ws.on("error", error => {
        readyReject(error);
    });

    try {
        await new Promise((resolve, reject) => {
            ws.once("open", resolve);
            ws.once("error", reject);
        });

        console.log("Connected to Vāk");

        await Promise.race([
            readyPromise,
            sleep(20000).then(() => {
                throw new Error("Prisma readiness timeout");
            }),
        ]);

        console.log("Streaming input audio...");

        for (let offset = 0; offset < pcm.length; offset += FRAME_BYTES) {
            let frame = pcm.subarray(offset, offset + FRAME_BYTES);

            if (frame.length < FRAME_BYTES) {
                const padded = Buffer.alloc(FRAME_BYTES);
                frame.copy(padded);
                frame = padded;
            }

            if (ws.readyState !== WebSocket.OPEN) {
                throw new Error("Proxy connection closed while streaming");
            }

            ws.send(frame, { binary: true });
            await sleep(FRAME_INTERVAL_MS);
        }

        console.log("Audio sent. Committing final utterance...");

        ws.send(JSON.stringify({ type: "commit" }));

        await Promise.race([
            idlePromise,
            sleep(30000).then(() => {
                throw new Error("Voice pipeline did not become idle");
            }),
        ]);

        if (pipelineError) {
            throw new Error(pipelineError);
        }

        if (translations.length === 0) {
            throw new Error("No translated text received");
        }

        if (audioChunks.length === 0) {
            throw new Error("No TTS audio received");
        }

        const outputPcm = Buffer.concat(audioChunks);

        await mkdir("outputs", { recursive: true });

        const outputWav = Buffer.concat([
            createWavHeader(outputPcm.length),
            outputPcm,
        ]);

        await writeFile(
            "outputs/proxy-punjabi-to-tamil.wav",
            outputWav
        );

        console.log("\n========== VOICE PIPELINE RESULT ==========");
        console.log("Translations:", translations.length);
        console.log("Audio chunks:", audioChunks.length);
        console.log("Audio bytes:", outputPcm.length);
        console.log("Audio duration:", (outputPcm.length / 96000).toFixed(2), "s");
        console.log("Saved: outputs/proxy-punjabi-to-tamil.wav");

    } finally {
        ws.close();
    }
}

main().catch(error => {
    console.error("PROXY VOICE TEST FAILED:", error);
    process.exitCode = 1;
});
