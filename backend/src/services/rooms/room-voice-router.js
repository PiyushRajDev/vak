
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

    // Never send a speaker their own generated speech.
    const recipients = [...room.participants.values()].filter(
        participant =>
            participant.id !== speakerId &&
            participant.connected &&
            participant.socket?.readyState === WebSocket.OPEN
    );

    if (recipients.length === 0) {
        console.log(
            `[ROOM VOICE] No connected listeners for ${speaker.displayName}`
        );
        return;
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

                onEvent: event => {
                    emitToGroup(event);
                },

                onAudioChunk: async (audio, info) => {
                    chunkCount++;

                    const metadata = {
                        type: "room_audio_chunk",
                        version: 1,
                        roomCode,
                        turnId,
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

// Serialize complete speech turns per room. Different speakers' STT
// sessions remain concurrent; their generated audio turns are queued.
export function enqueueRoomSpeechTurn({
    roomCode,
    speakerId,
    transcript,
}) {
    const previous =
        roomQueues.get(roomCode) || Promise.resolve();

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
                `[ROOM VOICE] Turn processing failed in ${roomCode}:`,
                error.message
            );
        });

    roomQueues.set(roomCode, current);

    void current.finally(() => {
        if (roomQueues.get(roomCode) === current) {
            roomQueues.delete(roomCode);
        }
    });

    return current;
}
