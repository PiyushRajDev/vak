
import {
    randomBytes,
    randomUUID,
    timingSafeEqual,
} from "node:crypto";

const rooms = new Map();
const MAX_PARTICIPANTS = 3;

export class RoomError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = "RoomError";
        this.statusCode = statusCode;
    }
}

function normalizeRoomCode(code) {
    return String(code || "").trim().toUpperCase();
}

function generateRoomCode() {
    return randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
}

function generateParticipantToken() {
    return randomBytes(32).toString("base64url");
}

function verifyToken(candidate, stored) {
    if (typeof candidate !== "string" || !stored) {
        return false;
    }

    const a = Buffer.from(candidate);
    const b = Buffer.from(stored);

    return a.length === b.length && timingSafeEqual(a, b);
}


export function authenticateParticipant({
    roomCode,
    participantId,
    token,
}) {
    const room = getRoomRecord(roomCode);

    if (!room) {
        throw new RoomError("Room not found", 404);
    }

    const participant = room.participants.get(participantId);

    if (!participant) {
        throw new RoomError("Participant not found", 404);
    }

    if (!verifyToken(token, participant.token)) {
        throw new RoomError("Invalid participant token", 403);
    }

    return participant;
}


function publicParticipant(participant) {
    return {
        id: participant.id,
        displayName: participant.displayName,
        spokenLanguage: participant.spokenLanguage,
        preferredLanguage: participant.preferredLanguage,
        voiceId: participant.voiceId,
        isMuted: participant.isMuted,
        connected: participant.connected,
        joinedAt: participant.joinedAt,
    };
}

function roomSnapshot(room) {
    return {
        roomCode: room.roomCode,
        status: room.status,
        createdAt: room.createdAt,
        maxParticipants: MAX_PARTICIPANTS,
        participants: [...room.participants.values()]
            .map(publicParticipant),
    };
}

function updateRoomStatus(room) {
    const hasConnectedParticipant =
        [...room.participants.values()]
            .some(participant => participant.connected);

    room.status = hasConnectedParticipant ? "active" : "waiting";
}

function createParticipant(data) {
    return {
        id: randomUUID(),
        token: generateParticipantToken(),

        displayName: data.displayName,
        spokenLanguage: data.spokenLanguage,
        preferredLanguage: data.preferredLanguage,

        voiceId: process.env.GNANI_TTS_VOICE || "Devansh",
        isMuted: false,
        connected: false,

        // The WebSocket reference will be attached in M8.
        socket: null,
        sttSocket: null,

        joinedAt: new Date().toISOString(),
    };
}

function joinResult(room, participant) {
    return {
        room: roomSnapshot(room),
        self: publicParticipant(participant),
        participantToken: participant.token,
    };
}

export function createRoom(data) {
    let roomCode;

    do {
        roomCode = generateRoomCode();
    } while (rooms.has(roomCode));

    const room = {
        roomCode,
        status: "waiting",
        createdAt: new Date().toISOString(),
        participants: new Map(),
    };

    const participant = createParticipant(data);

    room.participants.set(participant.id, participant);
    rooms.set(roomCode, room);

    return joinResult(room, participant);
}

export function joinRoom(code, data) {
    const roomCode = normalizeRoomCode(code);
    const room = rooms.get(roomCode);

    if (!room) {
        throw new RoomError("Room not found", 404);
    }

    if (room.participants.size >= MAX_PARTICIPANTS) {
        throw new RoomError("Room is full", 409);
    }

    const participant = createParticipant(data);

    room.participants.set(participant.id, participant);

    return joinResult(room, participant);
}

export function getRoom(code) {
    const room = rooms.get(normalizeRoomCode(code));

    if (!room) {
        throw new RoomError("Room not found", 404);
    }

    return roomSnapshot(room);
}

export function getRoomRecord(code) {
    return rooms.get(normalizeRoomCode(code)) || null;
}

export function getParticipantRecord(code, participantId) {
    const room = getRoomRecord(code);

    if (!room) return null;

    return room.participants.get(participantId) || null;
}

export function getRoomParticipantRecords(code) {
    const room = getRoomRecord(code);

    if (!room) return [];

    return [...room.participants.values()];
}

export function updateParticipant({
    roomCode,
    participantId,
    token,
    changes,
}) {
    const room = rooms.get(normalizeRoomCode(roomCode));

    if (!room) {
        throw new RoomError("Room not found", 404);
    }

    const participant = room.participants.get(participantId);

    if (!participant) {
        throw new RoomError("Participant not found", 404);
    }

    if (!verifyToken(token, participant.token)) {
        throw new RoomError("Invalid participant token", 403);
    }

    Object.assign(participant, changes);

    return {
        room: roomSnapshot(room),
        self: publicParticipant(participant),
    };
}

export function leaveParticipant({
    roomCode,
    participantId,
    token,
}) {
    const normalizedCode = normalizeRoomCode(roomCode);
    const room = rooms.get(normalizedCode);

    if (!room) {
        throw new RoomError("Room not found", 404);
    }

    const participant = room.participants.get(participantId);

    if (!participant) {
        throw new RoomError("Participant not found", 404);
    }

    if (!verifyToken(token, participant.token)) {
        throw new RoomError("Invalid participant token", 403);
    }

    room.participants.delete(participantId);

    if (room.participants.size === 0) {
        rooms.delete(normalizedCode);

        return {
            roomDeleted: true,
            roomCode: normalizedCode,
        };
    }

    updateRoomStatus(room);

    return {
        roomDeleted: false,
        room: roomSnapshot(room),
    };
}

// Used by M8 when a participant connects or disconnects.
export function setParticipantConnection(
    roomCode,
    participantId,
    connected,
    socket = null
) {
    const room = getRoomRecord(roomCode);

    if (!room) return false;

    const participant = room.participants.get(participantId);

    if (!participant) return false;

    participant.connected = connected;
    participant.socket = connected ? socket : null;

    updateRoomStatus(room);

    return true;
}
