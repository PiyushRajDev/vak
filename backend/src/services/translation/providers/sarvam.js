
const SARVAM_ENDPOINT = "https://api.sarvam.ai/translate";

export const SUPPORTED_LANGUAGES = new Set([
    "bn-IN",
    "en-IN",
    "gu-IN",
    "hi-IN",
    "kn-IN",
    "ml-IN",
    "mr-IN",
    "od-IN",
    "pa-IN",
    "ta-IN",
    "te-IN",
]);

export class TranslationError extends Error {
    constructor(message, statusCode, details = null) {
        super(message);
        this.name = "TranslationError";
        this.statusCode = statusCode;
        this.details = details;
    }
}

export async function translateWithSarvam({
    text,
    sourceLanguage,
    targetLanguage,
    model = "sarvam-translate:v1",
    mode,
}) {
    const apiKey = process.env.SARVAM_API_KEY;

    if (!apiKey) {
        throw new TranslationError(
            "SARVAM_API_KEY is not configured",
            500
        );
    }

    if (typeof text !== "string" || !text.trim()) {
        throw new TranslationError(
            "Translation input cannot be empty",
            400
        );
    }

    const maxLength =
        model === "mayura:v1" ? 1000 : 2000;

    if ([...text].length > maxLength) {
        throw new TranslationError(
            `Input exceeds ${maxLength} characters`,
            400
        );
    }

    if (!SUPPORTED_LANGUAGES.has(sourceLanguage)) {
        throw new TranslationError(
            `Unsupported source language: ${sourceLanguage}`,
            400
        );
    }

    if (!SUPPORTED_LANGUAGES.has(targetLanguage)) {
        throw new TranslationError(
            `Unsupported target language: ${targetLanguage}`,
            400
        );
    }

    if (sourceLanguage === targetLanguage) {
        return {
            translatedText: text,
            sourceLanguage,
            targetLanguage,
            provider: "none",
            skipped: true,
        };
    }

    const payload = {
        input: text,
        source_language_code: sourceLanguage,
        target_language_code: targetLanguage,
        model,
        numerals_format: "international",
    };

    // Only Mayura supports conversational translation modes.
    if (model === "mayura:v1" && mode) {
        payload.mode = mode;
    }

    const controller = new AbortController();

    const timeout = setTimeout(
        () => controller.abort(),
        8000
    );

    const startedAt = performance.now();

    try {
        const response = await fetch(SARVAM_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "api-subscription-key": apiKey,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        const latencyMs = Math.round(
            performance.now() - startedAt
        );

        const result = await response.json();

        if (!response.ok) {
            throw new TranslationError(
                `Sarvam translation failed: HTTP ${response.status}`,
                response.status,
                result
            );
        }

        if (
            typeof result.translated_text !== "string" ||
            !result.translated_text.trim()
        ) {
            throw new TranslationError(
                "Sarvam returned an empty translation",
                502,
                result
            );
        }

        return {
            translatedText: result.translated_text,
            sourceLanguage: result.source_language_code,
            targetLanguage,
            provider: model,
            requestId: result.request_id,
            latencyMs,
            skipped: false,
        };

    } catch (error) {
        if (error instanceof TranslationError) {
            throw error;
        }

        if (error.name === "AbortError") {
            throw new TranslationError(
                "Sarvam translation timed out",
                504
            );
        }

        throw new TranslationError(
            `Translation service unavailable: ${error.message}`,
            503
        );

    } finally {
        clearTimeout(timeout);
    }
}
