
import { translate } from "../translation/translator.js";
import { synthesizeSpeech } from "../tts/timbre.js";

export async function processVoiceTurn({
    text,
    sourceLanguage,
    targetLanguage,
    voice,
    onEvent = () => {},
    onAudioChunk,
}) {
    onEvent({
        type: "translation_started",
        sourceLanguage,
        targetLanguage,
        originalText: text,
    });

    const translation = await translate({
        text,
        sourceLanguage,
        targetLanguage,
    });

    onEvent({
        type: "translation",
        originalText: text,
        translatedText: translation.translatedText,
        sourceLanguage,
        targetLanguage,
        provider: translation.provider,
        latencyMs: translation.latencyMs ?? 0,
    });

    onEvent({
        type: "tts_started",
        language: targetLanguage,
        sampleRate: 48000,
        encoding: "pcm_s16le",
    });

    const synthesis = await synthesizeSpeech({
        text: translation.translatedText,
        language: targetLanguage,
        voice,
        collectAudio: false,
        onAudioChunk,
    });

    const result = {
        sourceLanguage,
        targetLanguage,
        translationMs: translation.latencyMs ?? 0,
        ttsMs: synthesis.totalMs,
        firstAudioChunkMs: synthesis.firstChunkMs,
        audioDurationSeconds: synthesis.audioDurationSeconds,
        chunkCount: synthesis.chunkCount,
    };

    onEvent({
        type: "tts_complete",
        ...result,
    });

    return result;
}
