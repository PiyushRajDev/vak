
import "dotenv/config";
import { performance } from "node:perf_hooks";

const API_URL = "https://api.sarvam.ai/translate";

const API_KEY = process.env.SARVAM_API_KEY;
const MODEL =
    process.env.SARVAM_TRANSLATION_MODEL || "mayura:v1";

const tests = [
    {
        id: "S1",
        description: "Punjabi to Tamil",
        input: "ਯਾਰ, ਮੈਨੂੰ ਲੱਗਦਾ ਹੈ ਚਾਬੀ ਮੇਜ਼ ਦੇ ਹੇਠਾਂ ਹੈ।",
        source: "pa-IN",
        target: "ta-IN",
        mode: "modern-colloquial",
    },
    {
        id: "S2",
        description: "Hinglish to Tamil",
        input: "Yaar, mujhe lagta hai key table ke neeche hai. Jaldi check karo.",
        source: "auto",
        target: "ta-IN",
        mode: "modern-colloquial",
    },
    {
        id: "S3",
        description: "Tanglish to Punjabi",
        input: "இந்த clue சரியா இல்ல, second box-ஐ check பண்ணலாம்.",
        source: "auto",
        target: "pa-IN",
        mode: "modern-colloquial",
    },
];

async function translate(test) {
    const startedAt = performance.now();

    const payload = {
        input: test.input,
        source_language_code: test.source,
        target_language_code: test.target,
        model: MODEL,
        mode: test.mode,
        numerals_format: "international",
    };

    const response = await fetch(API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "api-subscription-key": API_KEY,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
    });

    const latencyMs = Math.round(
        performance.now() - startedAt
    );

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            `HTTP ${response.status}: ${JSON.stringify(body)}`
        );
    }

    if (!body.translated_text) {
        throw new Error(
            `Unexpected API response: ${JSON.stringify(body)}`
        );
    }

    return {
        id: test.id,
        description: test.description,
        latencyMs,
        requestId: body.request_id,
        detectedSourceLanguage: body.source_language_code,
        targetLanguage: test.target,
        original: test.input,
        translated: body.translated_text,
    };
}

async function main() {
    if (!API_KEY) {
        throw new Error(
            "SARVAM_API_KEY missing. Check backend/.env"
        );
    }

    console.log("Vāk — Sarvam Mayura Translation Test");
    console.log("Model:", MODEL);
    console.log("Endpoint:", API_URL);

    const results = [];

    // Sequential requests for controlled benchmarking.
    for (const test of tests) {
        console.log(`\nRunning ${test.id}: ${test.description}`);

        const result = await translate(test);

        results.push(result);

        console.log("\nOriginal:");
        console.log(result.original);

        console.log("\nTranslated:");
        console.log(result.translated);

        console.log("\nLatency:", result.latencyMs, "ms");
        console.log("Detected source:", result.detectedSourceLanguage);
        console.log("Request ID:", result.requestId);
    }

    console.log("\n========== FINAL RESULTS ==========");

    console.table(
        results.map(result => ({
            id: result.id,
            description: result.description,
            latencyMs: result.latencyMs,
            detectedSourceLanguage:
                result.detectedSourceLanguage,
        }))
    );
}

main().catch(error => {
    console.error("\nSARVAM TEST FAILED:");
    console.error(error.message);
    process.exitCode = 1;
});
