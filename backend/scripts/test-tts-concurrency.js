
import "dotenv/config";

import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import readline from "node:readline/promises";

const API_URL =
    "https://api.vachana.ai/api/v1/tts/inference";

const API_KEY = process.env.GNANI_API_KEY_ID;

const OUTPUT_DIR = resolve("outputs");

const requests = [
    {
        id: "T3-1",
        text: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਇਹ ਪਹਿਲੀ ਸਮਕਾਲੀ ਜਾਂਚ ਹੈ।",
    },
    {
        id: "T3-2",
        text: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਇਹ ਦੂਜੀ ਸਮਕਾਲੀ ਜਾਂਚ ਹੈ।",
    },
    {
        id: "T3-3",
        text: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਇਹ ਤੀਜੀ ਸਮਕਾਲੀ ਜਾਂਚ ਹੈ।",
    },
];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

async function executeRequest(test) {
    const started = performance.now();

    try {
        const response = await fetch(API_URL, {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "X-API-Key-ID": API_KEY,
            },

            body: JSON.stringify({
                text: test.text,
                voice: "Devansh",
                model: "timbre-v3.0",
                language: "pa-IN",
                speed: 1.0,

                audio_config: {
                    sample_rate: 48000,
                    num_channels: 1,
                    sample_width: 2,
                    encoding: "linear_pcm",
                    container: "wav",
                },
            }),

            signal: AbortSignal.timeout(120000),
        });

        const latencyMs = Math.round(
            performance.now() - started
        );

        const responseHeaders = Object.fromEntries(
            [...response.headers.entries()].filter(
                ([name]) =>
                    /rate|limit|request|usage|credit/i.test(name)
            )
        );

        if (!response.ok) {
            return {
                id: test.id,
                status: response.status,
                latencyMs,
                error: await response.text(),
                headers: responseHeaders,
            };
        }

        const audio = Buffer.from(
            await response.arrayBuffer()
        );

        const filename = `${test.id.toLowerCase()}.wav`;

        await writeFile(
            resolve(OUTPUT_DIR, filename),
            audio
        );

        return {
            id: test.id,
            status: response.status,
            latencyMs,
            audioBytes: audio.length,
            filename,
            headers: responseHeaders,
        };

    } catch (error) {
        return {
            id: test.id,
            status: "NETWORK_ERROR",
            latencyMs: Math.round(
                performance.now() - started
            ),
            error: error.message,
        };
    }
}

async function main() {
    if (!API_KEY) {
        throw new Error("GNANI_API_KEY_ID is missing.");
    }

    await mkdir(OUTPUT_DIR, { recursive: true });

    const before = await rl.question(
        "Enter Gnani credit balance before T3: "
    );

    console.log("\nSending THREE simultaneous TTS requests...\n");

    const batchStarted = performance.now();

    // All three requests start without waiting for one another.
    const results = await Promise.all(
        requests.map(executeRequest)
    );

    const batchLatency = Math.round(
        performance.now() - batchStarted
    );

    console.log("\nIndividual request results:");
    console.table(results);

    console.log(
        `Total batch completion time: ${batchLatency} ms`
    );

    const after = await rl.question(
        "\nEnter Gnani credit balance after T3: "
    );

    const beforeBalance = Number(before);
    const afterBalance = Number(after);

    if (
        Number.isFinite(beforeBalance) &&
        Number.isFinite(afterBalance)
    ) {
        console.log(
            "Observed credit reduction:",
            beforeBalance - afterBalance
        );
    }

    console.log("\nT3 SUMMARY");

    console.log(
        "Successful requests:",
        results.filter(
            result => result.status === 200
        ).length
    );

    console.log(
        "Rate limited:",
        results.filter(
            result => result.status === 429
        ).length
    );

    console.log(
        "Other failures:",
        results.filter(
            result => result.status !== 200 &&
                     result.status !== 429
        ).length
    );

    console.log("\nFull results:");
    console.dir(results, { depth: null });
}

main()
    .catch(error => {
        console.error("T3 failed:", error.message);
        process.exitCode = 1;
    })
    .finally(() => rl.close());
