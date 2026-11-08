
import "dotenv/config";
import { performance } from "node:perf_hooks";

const API_KEY = process.env.SARVAM_API_KEY;

const MODES = [
    "formal",
    "classic-colloquial",
    "modern-colloquial",
    "code-mixed",
];

const input = "ਯਾਰ, ਮੈਨੂੰ ਲੱਗਦਾ ਹੈ ਚਾਬੀ ਮੇਜ਼ ਦੇ ਹੇਠਾਂ ਹੈ।";

async function testMode(mode) {
    const startedAt = performance.now();

    const response = await fetch(
        "https://api.sarvam.ai/translate",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "api-subscription-key": API_KEY,
            },
            body: JSON.stringify({
                input,
                source_language_code: "pa-IN",
                target_language_code: "ta-IN",
                model: "mayura:v1",
                mode,
                numerals_format: "international",
            }),
            signal: AbortSignal.timeout(30000),
        }
    );

    const latencyMs = Math.round(
        performance.now() - startedAt
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            `${mode}: HTTP ${response.status}: ${JSON.stringify(result)}`
        );
    }

    return {
        mode,
        latencyMs,
        translation: result.translated_text,
        requestId: result.request_id,
    };
}

async function main() {
    if (!API_KEY) {
        throw new Error("SARVAM_API_KEY missing");
    }

    console.log("Original:", input);

    for (const mode of MODES) {
        const result = await testMode(mode);

        console.log(`\n========== ${mode} ==========`);
        console.log("Translation:", result.translation);
        console.log("Latency:", result.latencyMs, "ms");
        console.log("Request ID:", result.requestId);
    }
}

main().catch(error => {
    console.error("Mode experiment failed:", error.message);
    process.exitCode = 1;
});
