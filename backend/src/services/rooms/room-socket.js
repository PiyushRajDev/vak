
import WebSocket, { WebSocketServer } from "ws";
import { enqueueRoomSpeechTurn } from "./room-voice-router.js";
import {
    authenticateParticipant,
    getRoom,
    getRoomParticipantRecords,
    getParticipantRecord,
    setParticipantConnection,
    updateParticipant,
    leaveParticipant,
    RoomError,
} from "./room-manager.js";

const WEB_ORIGIN =
    process.env.WEB_ORIGIN || "http://localhost:5173";

const PRISMA_ENDPOINT =
    "wss://api.vachana.ai/stt/v3/stream";

const AUTH_TIMEOUT_MS = 10000;
const MAX_AUDIO_BUFFERED_BYTES = 512 * 1024;

function sendJson(socket, message) {
    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    }
}

function broadcastRoomMessage(roomCode, message) {
    for (const participant of getRoomParticipantRecords(roomCode)) {
        sendJson(participant.socket, message);
    }
}

function publicSpeaker(roomCode, participantId) {
    const room = getRoom(roomCode);

    return room.participants.find(
        participant => participant.id === participantId
    ) || null;
}

export function attachRoomSocket(server) {
    const wss = new WebSocketServer({
        noServer: true,
        maxPayload: 1024 * 1024,
    });

    server.on("upgrade", (request, socket, head) => {
        let url;

        try {
            url = new URL(request.url, "http://localhost");
        } catch {
            socket.destroy();
            return;
        }

        if (url.pathname !== "/ws/room") {
            return;
        }

        const origin = request.headers.origin;

        if (origin && origin !== WEB_ORIGIN) {
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
        }

        wss.handleUpgrade(request, socket, head, client => {
            wss.emit("connection", client, request);
        });
    });

    wss.on("connection", client => {
        let authenticated = false;
        let roomCode = null;
        let participantId = null;
        let participantToken = null;

        let sttSocket = null;
        let sttReady = false;
        let stoppingStt = false;
        let stopTimer = null;

        const authTimer = setTimeout(() => {
            sendJson(client, {
                type: "auth_error",
                message: "Authentication timeout",
            });

            client.close(1008, "Authentication timeout");
        }, AUTH_TIMEOUT_MS);

        function finishSttSession(reason = "stopped") {
            const upstream = sttSocket;

            if (stopTimer) {
                clearTimeout(stopTimer);
                stopTimer = null;
            }

            sttSocket = null;
            sttReady = false;
            stoppingStt = false;

            const participant = getParticipantRecord(
                roomCode,
                participantId
            );

            if (participant?.sttSocket === upstream) {
                participant.sttSocket = null;
            }

            if (
                upstream &&
                (
                    upstream.readyState === WebSocket.OPEN ||
                    upstream.readyState === WebSocket.CONNECTING
                )
            ) {
                upstream.close(1000, reason);
            }

            sendJson(client, {
                type: "stt_stopped",
                reason,
            });
        }

        function requestStopStt() {
            if (!sttSocket) {
                sendJson(client, {
                    type: "stt_stopped",
                    reason: "no_active_session",
                });
                return;
            }

            if (stoppingStt) return;

            stoppingStt = true;

            if (sttSocket.readyState !== WebSocket.OPEN) {
                finishSttSession("stopped_before_ready");
                return;
            }

            sttSocket.send(JSON.stringify({
                type: "commit",
            }));

            sendJson(client, {
                type: "stt_commit_sent",
            });

            // Wait for a final transcript. If Prisma returns no
            // transcript (e.g. silence), use the fallback timeout.
            stopTimer = setTimeout(() => {
                finishSttSession("stop_timeout");
            }, 2500);
        }

        function startSttSession() {
            const participant = getParticipantRecord(
                roomCode,
                participantId
            );

            if (!participant) {
                sendJson(client, {
                    type: "error",
                    message: "Participant no longer exists",
                });
                return;
            }

            if (participant.isMuted) {
                sendJson(client, {
                    type: "error",
                    message: "Unmute before starting speech recognition",
                });
                return;
            }

            if (sttSocket) {
                if (sttReady) {
                    sendJson(client, {
                        type: "stt_ready",
                        message: "Speech recognition is already active",
                    });
                } else {
                    sendJson(client, {
                        type: "stt_connecting",
                    });
                }

                return;
            }

            if (!process.env.GNANI_API_KEY_ID) {
                sendJson(client, {
                    type: "stt_error",
                    message: "GNANI_API_KEY_ID is not configured",
                });
                return;
            }

            stoppingStt = false;

            const upstream = new WebSocket(PRISMA_ENDPOINT, {
                handshakeTimeout: 15000,
                headers: {
                    "x-api-key-id": process.env.GNANI_API_KEY_ID,
                    "model": "prisma-v3.0",
                    "language_code": participant.spokenLanguage,
                    "format": "transcribe",
                    "x-sample-rate": "16000",
                    "x-vad-threshold": "0.5",
                    "x-min-silence-ms": "500",
                    "x-min-speech-ms": "100",
                    "x-min-segment-ms": "120",
                },
            });

            sttSocket = upstream;
            participant.sttSocket = upstream;

            sendJson(client, {
                type: "stt_connecting",
                language: participant.spokenLanguage,
            });

            console.log(
                `[ROOM STT] Connecting ${participant.displayName} (${participant.spokenLanguage})`
            );

            upstream.on("open", () => {
                console.log(
                    `[ROOM STT] Provider WebSocket opened for ${participantId}`
                );
            });

            upstream.on("message", raw => {
                let event;

                try {
                    event = JSON.parse(raw.toString());
                } catch {
                    sendJson(client, {
                        type: "stt_event",
                        message: "Received an unrecognized provider response",
                    });
                    return;
                }

                if (event.type === "connected") {
                    sttReady = true;

                    sendJson(client, {
                        type: "stt_ready",
                        requestId: event.request_id,
                        config: event.config,
                    });

                    return;
                }

                if (
                    event.type === "transcript" &&
                    event.is_final
                ) {
                    const speaker = publicSpeaker(
                        roomCode,
                        participantId
                    );

                    if (!speaker) return;

                    const roomEvent = {
                        type: "speaker_transcript",
                        roomCode,
                        speaker,
                        transcript: {
                            text: event.text,
                            segmentId: event.segment_id,
                            segmentIndex: event.segment_index,
                            utteranceId: event.utterance_id,
                            detectedLanguage:
                                event.detected_language_code,
                            audioDurationMs: event.audio_duration_ms,
                            latencyMs: event.latency,
                        },
                    };

                    // Everyone, including the speaker, receives
                    // the same recognized transcript event.
                    broadcastRoomMessage(roomCode, roomEvent);

                    void enqueueRoomSpeechTurn({
                        roomCode,
                        speakerId: participantId,
                        transcript: event,
                    });

                    // A committed final transcript has arrived.
                    if (stoppingStt) {
                        if (stopTimer) clearTimeout(stopTimer);

                        stopTimer = setTimeout(() => {
                            finishSttSession("committed");
                        }, 350);
                    }

                    return;
                }

                if (
                    event.type === "speech_start" ||
                    event.type === "processing"
                ) {
                    broadcastRoomMessage(roomCode, {
                        type: "speaker_activity",
                        roomCode,
                        speaker: {
                            id: participantId,
                            displayName: participant.displayName,
                        },
                        event,
                    });

                    return;
                }

                sendJson(client, {
                    type: "stt_event",
                    event,
                });
            });

            upstream.on("error", error => {
                console.error(
                    `[ROOM STT] ${participantId}:`,
                    error.message
                );

                sendJson(client, {
                    type: "stt_error",
                    message: "Speech recognition connection failed",
                });
            });

            upstream.on("close", (code, reason) => {
                if (sttSocket !== upstream) return;

                sttSocket = null;
                sttReady = false;

                if (stopTimer) {
                    clearTimeout(stopTimer);
                    stopTimer = null;
                }

                stoppingStt = false;

                const currentParticipant = getParticipantRecord(
                    roomCode,
                    participantId
                );

                if (currentParticipant?.sttSocket === upstream) {
                    currentParticipant.sttSocket = null;
                }

                sendJson(client, {
                    type: "stt_disconnected",
                    code,
                    reason: reason.toString(),
                });
            });
        }

        function rejectAuthentication(message) {
            clearTimeout(authTimer);

            sendJson(client, {
                type: "auth_error",
                message,
            });

            client.close(1008, "Authentication failed");
        }

        client.on("message", (raw, isBinary) => {
            // First message authenticates the participant.
            if (!authenticated) {
                if (isBinary) {
                    rejectAuthentication(
                        "Authentication must be a JSON message"
                    );
                    return;
                }

                let auth;

                try {
                    auth = JSON.parse(raw.toString());
                } catch {
                    rejectAuthentication(
                        "Invalid authentication message"
                    );
                    return;
                }

                if (auth.type !== "auth") {
                    rejectAuthentication(
                        "First message must have type 'auth'"
                    );
                    return;
                }

                try {
                    const participant = authenticateParticipant({
                        roomCode: auth.roomCode,
                        participantId: auth.participantId,
                        token: auth.token,
                    });

                    if (
                        participant.connected &&
                        participant.socket?.readyState === WebSocket.OPEN
                    ) {
                        rejectAuthentication(
                            "Participant already has an active connection"
                        );
                        return;
                    }

                    roomCode = getRoom(auth.roomCode).roomCode;
                    participantId = participant.id;
                    participantToken = auth.token;

                    authenticated = true;
                    clearTimeout(authTimer);

                    setParticipantConnection(
                        roomCode,
                        participantId,
                        true,
                        client
                    );

                    const room = getRoom(roomCode);
                    const self = room.participants.find(
                        item => item.id === participantId
                    );

                    sendJson(client, {
                        type: "room_joined",
                        room,
                        self,
                    });

                    broadcastRoomMessage(roomCode, {
                        type: "room_updated",
                        room: getRoom(roomCode),
                    });

                    console.log(
                        `[ROOM] ${self.displayName} connected to ${roomCode}`
                    );

                } catch (error) {
                    rejectAuthentication(
                        error instanceof RoomError
                            ? error.message
                            : "Could not authenticate participant"
                    );
                }

                return;
            }

            // Audio frames flow from browser to this participant's
            // own Prisma session. They are never mixed with another
            // participant's microphone frames.
            if (isBinary) {
                if (!sttSocket || !sttReady ||
                    sttSocket.readyState !== WebSocket.OPEN) {
                    sendJson(client, {
                        type: "audio_not_ready",
                        message: "Send start_audio and wait for stt_ready first",
                    });
                    return;
                }

                if (raw.length !== 1024) {
                    sendJson(client, {
                        type: "audio_error",
                        message: `Invalid PCM frame size: ${raw.length}. Expected 1024 bytes.`,
                    });
                    return;
                }

                if (sttSocket.bufferedAmount > MAX_AUDIO_BUFFERED_BYTES) {
                    sendJson(client, {
                        type: "audio_backpressure",
                        message: "Speech service is receiving audio too slowly",
                    });
                    return;
                }

                sttSocket.send(raw, { binary: true });
                return;
            }

            let control;

            try {
                control = JSON.parse(raw.toString());
            } catch {
                sendJson(client, {
                    type: "error",
                    message: "Invalid JSON control message",
                });
                return;
            }

            if (control.type === "ping") {
                sendJson(client, {
                    type: "pong",
                    timestamp: Date.now(),
                });
                return;
            }

            if (control.type === "start_audio") {
                startSttSession();
                return;
            }

            if (control.type === "commit") {
                if (sttSocket?.readyState === WebSocket.OPEN && sttReady) {
                    sttSocket.send(JSON.stringify({
                        type: "commit",
                    }));

                    sendJson(client, {
                        type: "stt_commit_sent",
                    });
                } else {
                    sendJson(client, {
                        type: "error",
                        message: "No active STT session",
                    });
                }

                return;
            }

            if (control.type === "stop_audio") {
                requestStopStt();
                return;
            }

            if (control.type === "set_mute") {
                if (typeof control.isMuted !== "boolean") {
                    sendJson(client, {
                        type: "error",
                        message: "isMuted must be a boolean",
                    });
                    return;
                }

                try {
                    updateParticipant({
                        roomCode,
                        participantId,
                        token: participantToken,
                        changes: {
                            isMuted: control.isMuted,
                        },
                    });

                    sendJson(client, {
                        type: "mute_updated",
                        isMuted: control.isMuted,
                    });

                    broadcastRoomMessage(roomCode, {
                        type: "room_updated",
                        room: getRoom(roomCode),
                    });

                    // Muting also stops the paid STT session.
                    if (control.isMuted) {
                        requestStopStt();
                    }

                } catch (error) {
                    sendJson(client, {
                        type: "error",
                        message: error.message,
                    });
                }

                return;
            }

            if (control.type === "leave") {
                try {
                    // Close the provider session before removing
                    // the participant from the room.
                    finishSttSession("participant_left");

                    const result = leaveParticipant({
                        roomCode,
                        participantId,
                        token: participantToken,
                    });

                    sendJson(client, {
                        type: "left_room",
                        roomDeleted: result.roomDeleted,
                    });

                    if (!result.roomDeleted) {
                        broadcastRoomMessage(roomCode, {
                            type: "room_updated",
                            room: getRoom(roomCode),
                        });
                    }

                    console.log(
                        `[ROOM] Participant ${participantId} left ${roomCode}`
                    );

                    client.close(1000, "Left room");

                } catch (error) {
                    sendJson(client, {
                        type: "error",
                        message: error.message,
                    });
                }

                return;
            }

            sendJson(client, {
                type: "error",
                message: "Unsupported room control message",
            });
        });

        client.on("close", () => {
            clearTimeout(authTimer);

            if (!authenticated || !roomCode || !participantId) {
                return;
            }

            finishSttSession("room_connection_closed");

            const participant = getParticipantRecord(
                roomCode,
                participantId
            );

            // Prevent an old socket from disconnecting a newer one.
            if (participant?.socket === client) {
                setParticipantConnection(
                    roomCode,
                    participantId,
                    false
                );

                broadcastRoomMessage(roomCode, {
                    type: "room_updated",
                    room: getRoom(roomCode),
                });

                console.log(
                    `[ROOM] Participant ${participantId} disconnected from ${roomCode}`
                );
            }
        });

        client.on("error", error => {
            console.error("[ROOM] WebSocket error:", error.message);
        });
    });

    console.log("[ROOM] Authenticated WebSocket registered at /ws/room");
}
