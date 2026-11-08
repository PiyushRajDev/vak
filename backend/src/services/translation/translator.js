
import { translateWithSarvam } from "./providers/sarvam.js";

const DEFAULT_MODEL =
    process.env.SARVAM_TRANSLATION_MODEL ||
    "sarvam-translate:v1";

export async function translate({
    text,
    sourceLanguage,
    targetLanguage,
    context = [],
    model = DEFAULT_MODEL,
}) {
    // Context is accepted in the interface so that
    // we can support context-aware providers later.
    // Sarvam Translate currently receives the utterance
    // directly; context is not silently appended.

    const result = await translateWithSarvam({
        text,
        sourceLanguage,
        targetLanguage,
        model,
    });

    return {
        ...result,
        contextUsed: false,
    };
}
