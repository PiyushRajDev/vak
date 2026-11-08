
import "dotenv/config";

import { writeFile, mkdir } from "node:fs/promises";

import { translate } from "../src/services/translation/translator.js";
import { synthesizeSpeech } from "../src/services/tts/timbre.js";

const INPUT_TEXT =
    "नमस्ते! वाक में आपका स्वागत है। क्या आप मेरी आवाज़ सुन पा रहे हैं?";

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
    console.log("\n========== STEP 1: TRANSLATION ==========");

    const translation = await translate({
        text: INPUT_TEXT,
        sourceLanguage: "hi-IN",
        targetLanguage: "ta-IN",
    });

    console.log("Hindi:", INPUT_TEXT);
    console.log("Tamil:", translation.translatedText);
    console.log("Translation latency:", translation.latencyMs, "ms");

    console.log("\n========== STEP 2: SPEECH GENERATION ==========");

    const synthesis = await synthesizeSpeech({
        text: translation.translatedText,
        language: "ta-IN",
        voice: process.env.GNANI_TTS_VOICE || "Devansh",
        onAudioChunk: (chunk, metadata) => {
            if (metadata.chunkNumber === 1) {
                console.log(
                    "First audio chunk:",
                    chunk.length,
                    "bytes"
                );
            }
        },
    });

    console.log("\n========== RESULTS ==========");

    console.table([{
        translationMs: translation.latencyMs,
        ttsConnectionMs: synthesis.connectMs,
        firstAudioChunkMs: synthesis.firstChunkMs,
        ttsTotalMs: synthesis.totalMs,
        audioChunks: synthesis.chunkCount,
        audioBytes: synthesis.audioBytes,
        audioDurationSeconds:
            synthesis.audioDurationSeconds.toFixed(2),
    }]);

    await mkdir("outputs", { recursive: true });

    const wav = Buffer.concat([
        createWavHeader(synthesis.pcm.length),
        synthesis.pcm,
    ]);

    const outputPath = "outputs/hindi-to-tamil.wav";

    await writeFile(outputPath, wav);

    console.log("Saved:", outputPath);
}

main().catch(error => {
    console.error("VOICE PIPELINE FAILED:", error);
    process.exitCode = 1;
});
