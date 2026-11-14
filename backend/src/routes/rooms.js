
import { Router } from "express";
import { z } from "zod";

import {
    createRoom,
    joinRoom,
    getRoom,
    getRoomRecord,
    updateParticipant,
    leaveParticipant,
    verifyToken,
    RoomError,
} from "../services/rooms/room-manager.js";
import { broadcastRoomMessage } from "../services/rooms/room-socket.js";

const router = Router();

const supportedLanguages = [
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
];

const languageSchema = z.enum(supportedLanguages);

const participantSchema = z.object({
    displayName: z.string().trim().min(1).max(24),
    spokenLanguage: languageSchema,
    preferredLanguage: languageSchema,
});

const updateSchema = z.object({
    displayName: z.string().trim().min(1).max(24).optional(),
    spokenLanguage: languageSchema.optional(),
    preferredLanguage: languageSchema.optional(),
    isMuted: z.boolean().optional(),
}).refine(
    data => Object.keys(data).length > 0,
    { message: "At least one field must be provided" }
);

function parseBody(schema, body, res) {
    const result = schema.safeParse(body);

    if (!result.success) {
        res.status(400).json({
            error: "Invalid request",
            details: result.error.issues,
        });

        return null;
    }

    return result.data;
}

function sendError(res, error) {
    if (error instanceof RoomError) {
        return res.status(error.statusCode).json({
            error: error.message,
        });
    }

    console.error("[ROOMS] Unexpected error:", error);

    return res.status(500).json({
        error: "Internal room service error",
    });
}

// Create a room and automatically join as its first participant.
router.post("/", (req, res) => {
    const data = parseBody(participantSchema, req.body, res);

    if (!data) return;

    try {
        const result = createRoom(data);
        return res.status(201).json(result);
    } catch (error) {
        return sendError(res, error);
    }
});

// Join an existing room.
router.post("/:roomCode/join", (req, res) => {
    const data = parseBody(participantSchema, req.body, res);

    if (!data) return;

    try {
        const result = joinRoom(req.params.roomCode, data);
        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error);
    }
});

// Get room details and participant list.
router.get("/:roomCode", (req, res) => {
    try {
        const room = getRoom(req.params.roomCode);
        return res.json(room);
    } catch (error) {
        return sendError(res, error);
    }
});

// Update your own profile or microphone state.
router.patch("/:roomCode/participants/:participantId", (req, res) => {
    const changes = parseBody(updateSchema, req.body, res);

    if (!changes) return;

    try {
        const result = updateParticipant({
            roomCode: req.params.roomCode,
            participantId: req.params.participantId,
            token: req.headers["x-participant-token"],
            changes,
        });

        return res.json(result);
    } catch (error) {
        return sendError(res, error);
    }
});

// Leave or remove a participant from a room.
router.delete("/:roomCode/participants/:participantId", (req, res) => {
    try {
        const token = req.headers["x-participant-token"];
        const room = getRoomRecord(req.params.roomCode);

        if (!room) {
            return res.status(404).json({ error: "Room not found" });
        }

        const targetId = req.params.participantId;
        const target = room.participants.get(targetId);

        if (!target) {
            return res.status(404).json({ error: "Participant not found" });
        }

        const callerIsSelf = verifyToken(token, target.token);
        const adminParticipant = room.participants.get(room.adminParticipantId);
        const callerIsAdmin = adminParticipant && verifyToken(token, adminParticipant.token);

        if (!callerIsSelf && !callerIsAdmin) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        // If removed by admin, notify target and clean up their connections
        if (!callerIsSelf && callerIsAdmin) {
            if (target.sttSocket) {
                try {
                    target.sttSocket.close(1000, "removed_by_admin");
                } catch {}
                target.sttSocket = null;
            }

            if (target.socket) {
                try {
                    target.socket.send(JSON.stringify({
                        type: "removed_from_room",
                        reason: "You were removed from the room by the admin",
                    }));
                    target.socket.close(1000, "Removed by admin");
                } catch {}
            }
        }

        const result = leaveParticipant({
            roomCode: req.params.roomCode,
            participantId: targetId,
            bypassTokenCheck: true,
        });

        if (!result.roomDeleted) {
            broadcastRoomMessage(req.params.roomCode, {
                type: "room_updated",
                room: getRoom(req.params.roomCode),
            });
        }

        return res.json(result);
    } catch (error) {
        return sendError(res, error);
    }
});

export default router;
