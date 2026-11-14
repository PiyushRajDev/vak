
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

import {
    getRoomRecord,
    getRoomParticipantRecords,
    getParticipantRecord,
} from "./room-manager.js";

import { SUPPORTED_LANGUAGES } from "../translation/providers/sarvam.js";
import { processVoiceTurn } from "../voice/voice-pipeline.js";

const roomQueues = new Map();

function sendJson(participant, message) {
    const socket = participant?.socket;

    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    }
}

function getLiveRecipient(roomCode, participantId) {
    const participant = getParticipantRecord(
        roomCode,
        participantId
    );

    if (
        !participant ||
        !participant.connected ||
        participant.socket?.readyState !== WebSocket.OPEN
    ) {
        return null;
    }

    return participant;
}

// Binary envelope:
// [4-byte big-endian JSON header length][JSON metadata][PCM audio]
function sendAudioChunk(participant, metadata, audio) {
    const socket = participant?.socket;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    const header = Buffer.from(JSON.stringify(metadata));

    const packet = Buffer.allocUnsafe(
        4 + header.length + audio.length
    );

    packet.writeUInt32BE(header.length, 0);
    header.copy(packet, 4);
    audio.copy(packet, 4 + header.length);

    socket.send(packet, { binary: true });

    return true;
}

function getSpeakerInfo(participant) {
    return {
        id: participant.id,
        displayName: participant.displayName,
        spokenLanguage: participant.spokenLanguage,
    };
}

async function processRoomTurn({
    roomCode,
    speakerId,
    transcript,
}) {
    const room = getRoomRecord(roomCode);

    if (!room) return;

    const speaker = room.participants.get(speakerId);

    if (!speaker) return;

    const detectedLanguage =
        transcript.detected_language_code;

    // Only allow languages we explicitly support.
    const sourceLanguage =
        SUPPORTED_LANGUAGES.has(detectedLanguage)
            ? detectedLanguage
            : speaker.spokenLanguage;

    if (!SUPPORTED_LANGUAGES.has(sourceLanguage)) {
        console.error(
            `[ROOM VOICE] Unsupported source language: ${sourceLanguage}`
        );
        return;
    }

    // In a multi-party conversation, never send a speaker their own generated speech.
    // If the speaker is currently alone in the room, allow self-routing so solo testing works.
    let recipients = [...room.participants.values()].filter(
        participant =>
            participant.id !== speakerId &&
            participant.connected &&
            participant.socket?.readyState === WebSocket.OPEN
    );

    if (recipients.length === 0) {
        // Only allow solo self-routing if there are NO other participants registered in the room at all.
        // If other participants exist (even if temporarily disconnected or reconnecting), never loop back to speaker.
        const otherParticipants = [...room.participants.values()].filter(
            participant => participant.id !== speakerId
        );

        if (otherParticipants.length === 0 && speaker.connected && speaker.socket?.readyState === WebSocket.OPEN) {
            recipients = [speaker];
            console.log(
                `[ROOM VOICE] ${speaker.displayName} is solo in ${roomCode}; routing self-translation`
            );
        } else {
            console.log(
                `[ROOM VOICE] No connected listeners for ${speaker.displayName}`
            );
            return;
        }
    }

    // Group listeners by target language and voice.
    // Different listeners in the same group reuse one synthesis.
    const groups = new Map();

    for (const recipient of recipients) {
        const language = recipient.preferredLanguage;
        const voice = recipient.voiceId;

        const key = JSON.stringify([language, voice]);

        if (!groups.has(key)) {
            groups.set(key, {
                language,
                voice,
                participantIds: [],
            });
        }

        groups.get(key).participantIds.push(recipient.id);
    }

    const turnId = randomUUID();
    const speakerInfo = getSpeakerInfo(speaker);

    console.log(
        `[ROOM VOICE] ${speaker.displayName} spoke ${sourceLanguage}; ` +
        `${groups.size} distinct listener groups`
    );

    const tasks = [...groups.values()].map(async group => {
        const targetLanguage = group.language;

        try {
            if (!SUPPORTED_LANGUAGES.has(targetLanguage)) {
                throw new Error(
                    `Unsupported target language: ${targetLanguage}`
                );
            }

            const recipientsInGroup = () =>
                group.participantIds
                    .map(id => getLiveRecipient(roomCode, id))
                    .filter(Boolean);

            const emitToGroup = message => {
                for (const recipient of recipientsInGroup()) {
                    sendJson(recipient, {
                        ...message,
                        roomCode,
                        turnId,
                        speaker: speakerInfo,
                        targetLanguage,
                    });
                }
            };

            emitToGroup({
                type: "voice_turn_started",
                sourceLanguage,
                originalText: transcript.text,
            });

            let chunkCount = 0;

            const result = await processVoiceTurn({
                text: transcript.text,
                sourceLanguage,
                targetLanguage,
                voice: group.voice,
                utteranceId: transcript.utterance_id || transcript.segment_id,

                onEvent: event => {
                    emitToGroup(event);
                },

                onAudioChunk: async (audio, info) => {
                    chunkCount++;

                    // Quick non-cryptographic fingerprint of first 64 bytes.
                    // Logged on the SEND boundary (TRACE 2) so it can be
                    // correlated with TTS generation (TRACE 1) and frontend
                    // receive / playback (TRACE 3, TRACE 4).
                    let pHash = 0;
                    for (let i = 0; i < Math.min(audio.length, 64); i++) {
                        pHash = (pHash * 31 + audio[i]) >>> 0;
                    }
                    const payloadHash = pHash.toString(16);

                    const chunkDurationSeconds = audio.length / (48000 * 2);

                    const metadata = {
                        type: "room_audio_chunk",
                        version: 1,
                        roomCode,
                        turnId,
                        utteranceId: transcript.utterance_id || transcript.segment_id,
                        generationId: info.requestId || null,
                        speakerId,
                        speakerName: speakerInfo.displayName,
                        targetLanguage,
                        voiceId: group.voice,
                        chunkIndex: info.chunkNumber,
                        providerChunkIndex:
                            info.providerChunkIndex,
                        sampleRate: 48000,
                        channels: 1,
                        encoding: "pcm_s16le",
                    };

                    if (process.env.VAK_TTS_TRACE === "1") {
                        console.log(JSON.stringify({
                            t: "TTS_TRACE",
                            event: "chunkSent",
                            turnId,
                            utteranceId: metadata.utteranceId,
                            generationId: metadata.generationId,
                            chunkIndex: info.chunkNumber,
                            providerChunkIndex: info.providerChunkIndex,
                            payloadHash,
                            chunkDurationSeconds: Number(chunkDurationSeconds.toFixed(4)),
                            audioBytes: audio.length,
                            recipientCount: group.participantIds.length,
                            ts: Date.now(),
                        }));
                    }

                    for (const recipientId of group.participantIds) {
                        const recipient = getLiveRecipient(
                            roomCode,
                            recipientId
                        );

                        if (recipient) {
                            sendAudioChunk(
                                recipient,
                                metadata,
                                audio
                            );
                        }
                    }
                },
            });

            emitToGroup({
                type: "room_tts_complete",
                ...result,
                chunksDelivered: chunkCount,
            });

            console.log(
                `[ROOM VOICE] Turn ${turnId} delivered ` +
                `${targetLanguage} audio in ${chunkCount} chunks`
            );

        } catch (error) {
            console.error(
                `[ROOM VOICE] ${targetLanguage} failed:`,
                error.message
            );

            for (const recipient of recipientsInGroup()) {
                sendJson(recipient, {
                    type: "room_pipeline_error",
                    roomCode,
                    turnId,
                    speaker: speakerInfo,
                    targetLanguage,
                    message: error.message,
                });
            }
        }
    });

    await Promise.all(tasks);
}

// Serialize speech turns per speaker so an individual speaker's turns
// play in order, while allowing different speakers to communicate concurrently.
export function enqueueRoomSpeechTurn({
    roomCode,
    speakerId,
    transcript,
}) {
    const queueKey = `${roomCode}:${speakerId}`;
    const previous =
        roomQueues.get(queueKey) || Promise.resolve();

    const current = previous
        .catch(() => {})
        .then(() =>
            processRoomTurn({
                roomCode,
                speakerId,
                transcript,
            })
        )
        .catch(error => {
            console.error(
                `[ROOM VOICE] Turn processing failed in ${roomCode} for ${speakerId}:`,
                error.message
            );
        });

    roomQueues.set(queueKey, current);

    void current.finally(() => {
        if (roomQueues.get(queueKey) === current) {
            roomQueues.delete(queueKey);
        }
    });

    return current;
}
