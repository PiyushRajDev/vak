
import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import readline from "node:readline/promises";

const API_URL =
    "https://api.vachana.ai/api/v1/tts/inference";

const API_KEY = process.env.GNANI_API_KEY_ID;

const MODEL = "timbre-v3.0";
const VOICE = "Devansh";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(scriptDir, "../outputs");

const tests = [
    {
        id: "T2-A",
        language: "pa-IN",
        languageName: "Punjabi",
        filename: "t2-a-punjabi-short.wav",
        text: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਵਾਕ ਵਿੱਚ ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ।",
    },
    {
        id: "T2-B",
        language: "ta-IN",
        languageName: "Tamil",
        filename: "t2-b-tamil-medium.wav",
        text: "வணக்கம்! வாக் அறைக்குள் உங்களை வரவேற்கிறோம். நீங்கள் பேசும் மொழியை மற்றவர்கள் தங்கள் மொழியில் கேட்க முடியும்.",
    },
    {
        id: "T2-C",
        language: "pa-IN",
        languageName: "Punjabi",
        filename: "t2-c-punjabi-long.wav",
        text: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਵਾਕ ਇੱਕ ਅਜਿਹਾ ਲਾਈਵ ਵੌਇਸ ਰੂਮ ਹੈ ਜਿੱਥੇ ਹਰ ਵਿਅਕਤੀ ਆਪਣੀ ਭਾਸ਼ਾ ਵਿੱਚ ਗੱਲ ਕਰ ਸਕਦਾ ਹੈ। ਦੂਜੇ ਲੋਕ ਉਸਦੀ ਗੱਲ ਆਪਣੀ ਪਸੰਦ ਦੀ ਭਾਸ਼ਾ ਵਿੱਚ ਸੁਣਦੇ ਹਨ। ਇਸ ਤਰ੍ਹਾਂ ਕਿਸੇ ਨੂੰ ਵੀ ਇੱਕ ਸਾਂਝੀ ਭਾਸ਼ਾ ਬੋਲਣ ਦੀ ਲੋੜ ਨਹੀਂ ਰਹਿੰਦੀ।",
    },
];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function countCharacters(text) {
    const segmenter = new Intl.Segmenter("und", {
        granularity: "grapheme",
    });

    return [...segmenter.segment(text)].length;
}


function inspectWav(buffer) {
    if (
        buffer.toString("ascii", 0, 4) !== "RIFF" ||
        buffer.toString("ascii", 8, 12) !== "WAVE"
    ) {
        return null;
    }

    let offset = 12;
    let byteRate = 0;
    let declaredDataSize = 0;
    let dataOffset = null;

    while (offset + 8 <= buffer.length) {
        const chunkName = buffer.toString(
            "ascii",
            offset,
            offset + 4
        );

        const chunkSize = buffer.readUInt32LE(offset + 4);

        if (chunkName === "fmt " && chunkSize >= 16) {
            byteRate = buffer.readUInt32LE(offset + 16);
        }

        if (chunkName === "data") {
            declaredDataSize = chunkSize;
            dataOffset = offset + 8;
            break;
        }

        offset += 8 + chunkSize + (chunkSize % 2);
    }

    if (dataOffset === null || byteRate <= 0) {
        return null;
    }

    // Some WAV streams declare a placeholder data size.
    // Use the actual bytes present in the downloaded file.
    const availableBytes = buffer.length - dataOffset;

    const actualDataSize = Math.min(
        declaredDataSize,
        availableBytes
    );

    return {
        byteRate,
        dataSize: actualDataSize,
        declaredDataSize,
        durationSeconds: actualDataSize / byteRate,
    };
}


async function askBalance(message) {
    const answer = (
        await rl.question(message)
    ).trim();

    if (!answer) {
        return null;
    }

    const value = Number(answer);

    if (!Number.isFinite(value) || value < 0) {
        console.log("Invalid balance. Skipping measurement.");
        return null;
    }

    return value;
}

async function synthesize(test) {
    const payload = {
        text: test.text,
        voice: VOICE,
        model: MODEL,
        language: test.language,
        speed: 1.0,
        audio_config: {
            sample_rate: 48000,
            num_channels: 1,
            sample_width: 2,
            encoding: "linear_pcm",
            container: "wav",
        },
    };

    console.log(`\nStarting ${test.id}`);
    console.log(`Language: ${test.languageName}`);
    console.log(`Grapheme count: ${countCharacters(test.text)}`);

    const startedAt = performance.now();

    let response;

    try {
        response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key-ID": API_KEY,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(120000),
        });
    } catch (error) {
        throw new Error(
            `Network/request failure: ${error.message}`
        );
    }

    const latencyMs = Math.round(
        performance.now() - startedAt
    );

    if (!response.ok) {
        const errorBody = await response.text();

        throw new Error(
            `Gnani returned HTTP ${response.status}: ${errorBody}`
        );
    }

    const audioBuffer = Buffer.from(
        await response.arrayBuffer()
    );

    const metadata = inspectWav(audioBuffer);

    if (!metadata || metadata.durationSeconds === null) {
        throw new Error(
            "Response was successful but did not contain a valid WAV file."
        );
    }

    await writeFile(
        resolve(outputDir, test.filename),
        audioBuffer
    );

    const result = {
        id: test.id,
        language: test.languageName,
        graphemes: countCharacters(test.text),
        latencyMs,
        audioBytes: audioBuffer.length,
        audioDurationSeconds: Number(
            metadata.durationSeconds.toFixed(2)
        ),
        filename: test.filename,
        charactersPerSecond: Number(
            (
                countCharacters(test.text) /
                metadata.durationSeconds
            ).toFixed(2)
        ),
    };

    console.log("\nSUCCESS");
    console.table([result]);

    return result;
}

async function main() {
    if (!API_KEY) {
        throw new Error(
            "GNANI_API_KEY_ID is missing. Check backend/.env"
        );
    }

    await mkdir(outputDir, { recursive: true });

    const results = [];
    let previousBalance = await askBalance(
        "Enter current Gnani credit balance before T2: "
    );

    console.log("\nT2: Sequential Timbre v3.0 testing");
    console.log("The script will stop on the first failed request.");

    for (const test of tests) {
        console.log(
            "\nRefresh your Gnani dashboard before continuing."
        );

        await rl.question(
            `Press ENTER to execute ${test.id}...`
        );

        const result = await synthesize(test);

        const currentBalance = await askBalance(
            "Enter updated credit balance from dashboard (ENTER to skip): "
        );

        if (currentBalance !== null && previousBalance !== null) {
            result.creditConsumption =
                previousBalance - currentBalance;

            result.creditsPerGrapheme = Number(
                (
                    result.creditConsumption /
                    result.graphemes
                ).toFixed(5)
            );

            previousBalance = currentBalance;
        }

        results.push(result);
    }

    console.log("\n========== T2 FINAL RESULTS ==========");
    console.table(results);

    console.log(
        "\nAudio files saved in:",
        outputDir
    );
}

main()
    .catch((error) => {
        console.error("\nT2 FAILED:", error.message);
        process.exitCode = 1;
    })
    .finally(() => {
        rl.close();
    });
