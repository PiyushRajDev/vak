
import "dotenv/config";

import { translate } from "../src/services/translation/translator.js";

const testCases = [
    {
        name: "Punjabi to Tamil",
        text: "ਲਾਲ ਚਾਬੀ ਦੂਜੇ ਬਕਸੇ ਵਿੱਚ ਹੈ। ਤੀਜਾ ਬਕਸਾ ਨਾ ਖੋਲ੍ਹੋ।",
        sourceLanguage: "pa-IN",
        targetLanguage: "ta-IN",
    },
    {
        name: "Tamil to Punjabi",
        text: "இந்த clue சரியா இல்ல, second box-ஐ check பண்ணலாம்.",
        sourceLanguage: "ta-IN",
        targetLanguage: "pa-IN",
    },
];

async function main() {
    for (const test of testCases) {
        console.log(`\nTesting: ${test.name}`);

        const result = await translate({
            text: test.text,
            sourceLanguage: test.sourceLanguage,
            targetLanguage: test.targetLanguage,
        });

        console.log({
            original: test.text,
            translated: result.translatedText,
            provider: result.provider,
            latencyMs: result.latencyMs,
            requestId: result.requestId,
            contextUsed: result.contextUsed,
        });
    }

    // Test the same-language bypass.
    const bypass = await translate({
        text: "Hello",
        sourceLanguage: "en-IN",
        targetLanguage: "en-IN",
    });

    console.log("\nSame-language bypass:", bypass);
}

main().catch(error => {
    console.error("Translator test failed:", error);
    process.exitCode = 1;
});
