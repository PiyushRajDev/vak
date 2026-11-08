
import fs from "node:fs";
import WebSocket from "ws";

const WAV_PATH = "outputs/t4-punjabi-16k.wav";
const PROXY_URL = "ws://localhost:8000/ws/stt?language=pa-IN";

const FRAME_BYTES = 1024;
const FRAME_INTERVAL_MS = 32;

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

        // WAV chunks are word-aligned.
        offset = start + declaredSize + (declaredSize % 2);
    }

    if (!format || !pcmData) {
        throw new Error("Could not find WAV format or audio data");
    }

    if (
        format.audioFormat !== 1 ||
        format.channels !== 1 ||
        format.sampleRate !== 16000 ||
        format.bitsPerSample !== 16
    ) {
        throw new Error(
            `Expected mono 16 kHz PCM-16. Received: ${JSON.stringify(format)}`
        );
    }

    return pcmData;
}

async function main() {
    const wav = fs.readFileSync(WAV_PATH);
    const pcm = extractPcmFromWav(wav);

    console.log("Audio loaded");
    console.log("PCM bytes:", pcm.length);
    console.log("Audio duration:", (pcm.length / 32000).toFixed(2), "seconds");

    const ws = new WebSocket(PROXY_URL);

    let readyResolve;
    let readyReject;

    const providerReady = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });

    const transcripts = [];

    ws.on("message", raw => {
        let event;

        try {
            event = JSON.parse(raw.toString());
        } catch {
            console.log("[NON-JSON MESSAGE]");
            return;
        }

        if (event.type === "connected") {
            console.log("[PRISMA READY]", event);
            readyResolve(event);
            return;
        }

        if (event.type === "transcript") {
            transcripts.push(event);
            console.log("[TRANSCRIPT]", event);
            return;
        }

        if (event.type === "proxy_error") {
            console.error("[PROXY ERROR]", event);
            readyReject(new Error(event.message));
            return;
        }

        console.log("[PRISMA EVENT]", event);
    });

    ws.on("error", error => {
        console.error("[WEBSOCKET ERROR]", error.message);
        readyReject(error);
    });

    await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
    });

    console.log("Connected to Vāk proxy");

    // Do not send audio until Prisma is ready.
    await Promise.race([
        providerReady,
        sleep(20000).then(() => {
            throw new Error("Timed out waiting for Prisma readiness");
        }),
    ]);

    let frameCount = 0;

    console.log("Streaming audio frames...");

    for (let offset = 0; offset < pcm.length; offset += FRAME_BYTES) {
        let frame = pcm.subarray(offset, offset + FRAME_BYTES);

        // Pad the final frame if it is incomplete.
        if (frame.length < FRAME_BYTES) {
            const padded = Buffer.alloc(FRAME_BYTES);
            frame.copy(padded);
            frame = padded;
        }

        if (ws.readyState !== WebSocket.OPEN) {
            throw new Error("Proxy connection closed during streaming");
        }

        ws.send(frame, { binary: true });
        frameCount++;

        await sleep(FRAME_INTERVAL_MS);
    }

    console.log(`Sent ${frameCount} frames`);
    console.log("Committing final utterance...");

    ws.send(JSON.stringify({ type: "commit" }));

    // Allow Prisma to finish processing and send its final transcript.
    await sleep(3000);

    console.log("\n========== RESULT ==========");
    console.log("Transcript events received:", transcripts.length);

    for (const transcript of transcripts) {
        console.log(JSON.stringify(transcript, null, 2));
    }

    ws.close(1000, "Test complete");
}

main().catch(error => {
    console.error("Proxy test failed:", error);
    process.exitCode = 1;
});
