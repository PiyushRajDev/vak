
import "dotenv/config";
import { performance } from "node:perf_hooks";

const API_KEY = process.env.SARVAM_API_KEY;

const tests = [
    {
        id: "S5-A",
        model: "mayura:v1",
        mode: "code-mixed",
        source: "pa-IN",
        input: "ਯਾਰ, ਮੈਨੂੰ ਲੱਗਦਾ ਹੈ ਚਾਬੀ ਟੇਬਲ ਦੇ ਹੇਠਾਂ ਹੈ।",
    },
    {
        id: "S5-B",
        model: "mayura:v1",
        mode: "code-mixed",
        source: "pa-IN",
        input: "ਯਾਰ, ਮੈਨੂੰ ਲੱਗਦਾ ਹੈ ਚਾਬੀ ਮੇਜ਼ (table) ਦੇ ਹੇਠਾਂ ਹੈ।",
    },
    {
        id: "S5-C",
        model: "sarvam-translate:v1",
        mode: undefined,
        source: "pa-IN",
        input: "ਯਾਰ, ਮੈਨੂੰ ਲੱਗਦਾ ਹੈ ਚਾਬੀ ਮੇਜ਼ ਦੇ ਹੇਠਾਂ ਹੈ।",
    },
];

async function runTest(test) {
    const payload = {
        input: test.input,
        source_language_code: test.source,
        target_language_code: "ta-IN",
        model: test.model,
        numerals_format: "international",
    };

    if (test.mode) {
        payload.mode = test.mode;
    }

    const started = performance.now();

    const response = await fetch(
        "https://api.sarvam.ai/translate",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "api-subscription-key": API_KEY,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(30000),
        }
    );

    const latency = Math.round(
        performance.now() - started
    );

    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            `${test.id}: HTTP ${response.status} ${JSON.stringify(data)}`
        );
    }

    return {
        ...test,
        translated: data.translated_text,
        latency,
        requestId: data.request_id,
    };
}

async function main() {
    if (!API_KEY) {
        throw new Error("SARVAM_API_KEY missing");
    }

    for (const test of tests) {
        console.log(`\n========== ${test.id} ==========`);
        console.log("Model:", test.model);
        console.log("Input:", test.input);

        const result = await runTest(test);

        console.log("Translation:", result.translated);
        console.log("Latency:", result.latency, "ms");
        console.log("Request:", result.requestId);
    }
}

main().catch(error => {
    console.error("Semantic test failed:", error.message);
    process.exitCode = 1;
});
