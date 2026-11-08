
import fs from "node:fs";
import WebSocket from "ws";

const API = "http://localhost:8000";
const AUDIO_PATH = "outputs/t4-punjabi-16k.wav";

const FRAME_BYTES = 1024;
const FRAME_INTERVAL_MS = 32;

async function apiRequest(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...options.headers,
        },
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            `HTTP ${response.status}: ${JSON.stringify(data)}`
        );
    }

    return data;
}

function loadPcm(path) {
    const buffer = fs.readFileSync(path);

    if (
        buffer.toString("ascii", 0, 4) !== "RIFF" ||
        buffer.toString("ascii", 8, 12) !== "WAVE"
    ) {
        throw new Error("Invalid WAV file");
    }

    let format = null;
    let pcm = null;
    let offset = 12;

    while (offset + 8 <= buffer.length) {
        const chunkId = buffer.toString("ascii", offset, offset + 4);
        const declaredSize = buffer.readUInt32LE(offset + 4);
        const start = offset + 8;
        const end = Math.min(start + declaredSize, buffer.length);

        if (chunkId === "fmt ") {
            format = {
                audioFormat: buffer.readUInt16LE(start),
                channels: buffer.readUInt16LE(start + 2),
                sampleRate: buffer.readUInt32LE(start + 4),
                bitsPerSample: buffer.readUInt16LE(start + 14),
            };
        }

        if (chunkId === "data") {
            pcm = buffer.subarray(start, end);
            break;
        }

        offset = start + declaredSize + (declaredSize % 2);
    }

    if (!format || !pcm) {
        throw new Error("WAV format or audio data missing");
    }

    if (
        format.audioFormat !== 1 ||
        format.channels !== 1 ||
        format.sampleRate !== 16000 ||
        format.bitsPerSample !== 16
    ) {
        throw new Error(
            `Expected mono 16 kHz PCM16. Got ${JSON.stringify(format)}`
        );
    }

    return pcm;
}

function createRoomClient() {
    const ws = new WebSocket("ws://localhost:8000/ws/room");
    const events = [];
    const waiters = [];

    ws.on("message", raw => {
        let event;

        try {
            event = JSON.parse(raw.toString());
        } catch {
            return;
        }

        events.push(event);

        console.log(`[ROOM EVENT] ${event.type}`);

        for (const waiter of [...waiters]) {
            waiter.check();
        }
    });

    function waitForCount(
        type,
        predicate = () => true,
        count = 1,
        timeoutMs = 20000
    ) {
        const matching = () => events.filter(
            event => event.type === type && predicate(event)
        );

        const existing = matching();

        if (existing.length >= count) {
            return Promise.resolve(existing.slice(0, count));
        }

        return new Promise((resolve, reject) => {
            const waiter = {
                timer: null,

                check() {
                    const results = matching();

                    if (results.length >= count) {
                        clearTimeout(waiter.timer);

                        const index = waiters.indexOf(waiter);

                        if (index !== -1) {
                            waiters.splice(index, 1);
                        }

                        resolve(results.slice(0, count));
                    }
                },
            };

            waiter.timer = setTimeout(() => {
                const index = waiters.indexOf(waiter);

                if (index !== -1) {
                    waiters.splice(index, 1);
                }

                reject(
                    new Error(
                        `Timed out waiting for ${count} ${type} event(s)`
                    )
                );
            }, timeoutMs);

            waiters.push(waiter);
            waiter.check();
        });
    }

    const opened = new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
    });

    return {
        ws,
        opened,
        waitFor: (type, predicate, timeout) =>
            waitForCount(type, predicate, 1, timeout)
                .then(results => results[0]),
        waitForCount,
    };
}

async function connectParticipant(roomCode, participant) {
    const client = createRoomClient();

    await client.opened;

    const joined = client.waitFor("room_joined");

    client.ws.send(JSON.stringify({
        type: "auth",
        roomCode,
        participantId: participant.self.id,
        token: participant.participantToken,
    }));

    const result = await joined;

    console.log(`${result.self.displayName} authenticated`);

    return client;
}

async function streamPcm(client, pcm) {
    let frameCount = 0;

    for (let offset = 0; offset < pcm.length; offset += FRAME_BYTES) {
        let frame = pcm.subarray(offset, offset + FRAME_BYTES);

        if (frame.length < FRAME_BYTES) {
            const padded = Buffer.alloc(FRAME_BYTES);
            frame.copy(padded);
            frame = padded;
        }

        if (client.ws.readyState !== WebSocket.OPEN) {
            throw new Error("Room WebSocket closed during audio streaming");
        }

        client.ws.send(frame, { binary: true });
        frameCount++;

        await new Promise(resolve =>
            setTimeout(resolve, FRAME_INTERVAL_MS)
        );
    }

    return frameCount;
}

async function main() {
    let roomCode = null;
    const participants = [];
    const clients = [];

    try {
        console.log("\n1. Creating a temporary room...");

        const host = await apiRequest("/api/rooms", {
            method: "POST",
            body: JSON.stringify({
                displayName: "Audio Host",
                spokenLanguage: "pa-IN",
                preferredLanguage: "ta-IN",
            }),
        });

        roomCode = host.room.roomCode;
        participants.push(host);

        const guest = await apiRequest(
            `/api/rooms/${roomCode}/join`,
            {
                method: "POST",
                body: JSON.stringify({
                    displayName: "Audio Guest",
                    spokenLanguage: "ta-IN",
                    preferredLanguage: "pa-IN",
                }),
            }
        );

        participants.push(guest);

        console.log("Room:", roomCode);

        console.log("\n2. Authenticating both participants...");

        const hostClient = await connectParticipant(
            roomCode,
            host
        );

        clients.push(hostClient);

        const guestClient = await connectParticipant(
            roomCode,
            guest
        );

        clients.push(guestClient);

        console.log("\n3. Starting independent Prisma sessions...");

        const hostReady = hostClient.waitFor("stt_ready");
        const guestReady = guestClient.waitFor("stt_ready");

        hostClient.ws.send(JSON.stringify({
            type: "start_audio",
        }));

        guestClient.ws.send(JSON.stringify({
            type: "start_audio",
        }));

        await Promise.all([hostReady, guestReady]);

        console.log("Both Prisma sessions are ready.");

        console.log("\n4. Loading and streaming the Punjabi recording...");

        const pcm = loadPcm(AUDIO_PATH);

        console.log(
            "Audio duration:",
            (pcm.length / 32000).toFixed(2),
            "seconds"
        );

        const hostTranscripts = hostClient.waitForCount(
            "speaker_transcript",
            event => event.speaker.id === host.self.id,
            2
        );

        const guestTranscripts = guestClient.waitForCount(
            "speaker_transcript",
            event => event.speaker.id === host.self.id,
            2
        );

        const frames = await streamPcm(hostClient, pcm);

        console.log("Frames sent:", frames);

        hostClient.ws.send(JSON.stringify({
            type: "commit",
        }));

        console.log("\n5. Waiting for transcript broadcasts...");

        const [hostResults, guestResults] = await Promise.all([
            hostTranscripts,
            guestTranscripts,
        ]);

        console.log("\nHost received:");
        for (const event of hostResults) {
            console.log(event.transcript.text);
        }

        console.log("\nGuest received:");
        for (const event of guestResults) {
            console.log(event.transcript.text);
        }

        const hostText = hostResults.map(
            event => event.transcript.text
        );

        const guestText = guestResults.map(
            event => event.transcript.text
        );

        if (JSON.stringify(hostText) !== JSON.stringify(guestText)) {
            throw new Error("Participants received different transcripts");
        }

        console.log("\n6. Stopping Prisma sessions...");

        const hostStopped = hostClient.waitFor("stt_stopped");
        const guestStopped = guestClient.waitFor("stt_stopped");

        hostClient.ws.send(JSON.stringify({
            type: "stop_audio",
        }));

        guestClient.ws.send(JSON.stringify({
            type: "stop_audio",
        }));

        await Promise.all([hostStopped, guestStopped]);

        console.log("\n========== M8.2 PASSED ==========");
        console.log("Two authenticated room participants: passed");
        console.log("Two independent Prisma sessions: passed");
        console.log("PCM microphone uplink: passed");
        console.log("Final transcript processing: passed");
        console.log("Transcript broadcast to both participants: passed");
        console.log("STT session shutdown: passed");

    } finally {
        // Close sockets first, then remove temporary participants.
        for (const client of clients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.close();
            }
        }

        if (roomCode) {
            for (const participant of participants) {
                try {
                    await fetch(
                        `${API}/api/rooms/${roomCode}/participants/${participant.self.id}`,
                        {
                            method: "DELETE",
                            headers: {
                                "x-participant-token":
                                    participant.participantToken,
                            },
                        }
                    );
                } catch {
                    // The room may already have been cleaned up.
                }
            }
        }
    }
}

main().catch(error => {
    console.error("\nM8.2 TEST FAILED:", error.message);
    process.exitCode = 1;
});
