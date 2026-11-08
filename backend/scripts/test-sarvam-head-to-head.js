
import "dotenv/config";
import { performance } from "node:perf_hooks";

const API_KEY = process.env.SARVAM_API_KEY;

const providers = [
    {
        name: "Mayura",
        model: "mayura:v1",
        mode: "code-mixed",
    },
    {
        name: "Sarvam Translate",
        model: "sarvam-translate:v1",
    },
];

const cases = [
    {
        id: "H1",
        source: "pa-IN",
        target: "ta-IN",
        text: "ਯਾਰ, ਮੈਨੂੰ ਲੱਗਦਾ ਹੈ ਚਾਬੀ ਮੇਜ਼ ਦੇ ਹੇਠਾਂ ਹੈ।",
        expected: "The key is under the table.",
    },
    {
        id: "H2",
        source: "pa-IN",
        target: "ta-IN",
        text: "ਲਾਲ ਚਾਬੀ ਦੂਜੇ ਬਕਸੇ ਵਿੱਚ ਹੈ। ਤੀਜਾ ਬਕਸਾ ਨਾ ਖੋਲ੍ਹੋ।",
        expected: "The red key is in the second box. Do not open the third box.",
    },
    {
        id: "H3",
        source: "ta-IN",
        target: "pa-IN",
        text: "இந்த clue சரியா இல்ல, second box-ஐ check பண்ணலாம்.",
        expected: "This clue is not correct. Let's check the second box.",
    },
];

async function translate(provider, test) {
    const body = {
        input: test.text,
        source_language_code: test.source,
        target_language_code: test.target,
        model: provider.model,
        numerals_format: "international",
    };

    if (provider.mode) {
        body.mode = provider.mode;
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
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
        }
    );

    const latencyMs = Math.round(
        performance.now() - started
    );

    const data = await response.json();

    if (!response.ok) {
        return {
            test: test.id,
            provider: provider.name,
            status: response.status,
            error: JSON.stringify(data),
        };
    }

    return {
        test: test.id,
        provider: provider.name,
        status: response.status,
        latencyMs,
        expected: test.expected,
        original: test.text,
        translated: data.translated_text,
    };
}

async function main() {
    if (!API_KEY) {
        throw new Error("SARVAM_API_KEY missing");
    }

    const results = [];

    for (const test of cases) {
        console.log(`\n========== ${test.id} ==========`);

        for (const provider of providers) {
            console.log(`\nTesting ${provider.name}...`);

            const result = await translate(
                provider,
                test
            );

            results.push(result);

            console.log("Original:", result.original);
            console.log("Expected:", result.expected);
            console.log("Translated:", result.translated);
            console.log("Latency:", result.latencyMs);
        }
    }

    console.log("\n========== COMPARISON ==========");

    console.table(
        results.map(result => ({
            test: result.test,
            provider: result.provider,
            status: result.status,
            latencyMs: result.latencyMs,
            translation: result.translated,
        }))
    );
}

main().catch(error => {
    console.error("Benchmark failed:", error.message);
    process.exitCode = 1;
});
