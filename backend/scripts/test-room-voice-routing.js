
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
        const id = buffer.toString("ascii", offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        const start = offset + 8;
        const end = Math.min(start + size, buffer.length);

        if (id === "fmt ") {
            format = {
                audioFormat: buffer.readUInt16LE(start),
                channels: buffer.readUInt16LE(start + 2),
                sampleRate: buffer.readUInt32LE(start + 4),
                bitsPerSample: buffer.readUInt16LE(start + 14),
            };
        }

        if (id === "data") {
            pcm = buffer.subarray(start, end);
            break;
        }

        offset = start + size + (size % 2);
    }

    if (!format || !pcm) {
        throw new Error("WAV data missing");
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

function createRoomClient(name) {
    const ws = new WebSocket("ws://localhost:8000/ws/room");

    const events = [];
    const waiters = [];
    const audioPackets = [];

    ws.on("message", (raw, isBinary) => {
        if (isBinary) {
            try {
                const packet = Buffer.from(raw);

                if (packet.length < 5) {
                    throw new Error("Invalid audio envelope");
                }

                const headerSize = packet.readUInt32BE(0);

                if (headerSize <= 0 || 4 + headerSize > packet.length) {
                    throw new Error("Invalid audio metadata length");
                }

                const metadata = JSON.parse(
                    packet.subarray(4, 4 + headerSize).toString()
                );

                const audio = packet.subarray(4 + headerSize);

                audioPackets.push({
                    metadata,
                    audioBytes: audio.length,
                });

                console.log(
                    `[${name}] AUDIO ${metadata.targetLanguage} ` +
                    `chunk=${metadata.chunkIndex} bytes=${audio.length}`
                );

            } catch (error) {
                console.error(`[${name}] Invalid audio packet:`, error.message);
            }

            return;
        }

        let event;

        try {
            event = JSON.parse(raw.toString());
        } catch {
            return;
        }

        events.push(event);

        if (
            event.type === "speaker_transcript" ||
            event.type === "translation" ||
            event.type === "room_tts_complete" ||
            event.type === "room_pipeline_error"
        ) {
            console.log(
                `[${name}] ${event.type}`,
                event.targetLanguage || event.transcript?.text || ""
            );
        }

        for (const waiter of [...waiters]) {
            waiter.check();
        }
    });

    function waitFor(type, predicate = () => true, timeoutMs = 30000) {
        const existing = events.find(
            event => event.type === type && predicate(event)
        );

        if (existing) return Promise.resolve(existing);

        return new Promise((resolve, reject) => {
            const waiter = {
                timer: null,

                check() {
                    const found = events.find(
                        event => event.type === type && predicate(event)
                    );

                    if (!found) return;

                    clearTimeout(waiter.timer);

                    const index = waiters.indexOf(waiter);
                    if (index !== -1) waiters.splice(index, 1);

                    resolve(found);
                },
            };

            waiter.timer = setTimeout(() => {
                const index = waiters.indexOf(waiter);
                if (index !== -1) waiters.splice(index, 1);

                reject(new Error(`Timed out waiting for ${type}`));
            }, timeoutMs);

            waiters.push(waiter);
            waiter.check();
        });
    }
    
function waitForCount(
    type,
    predicate = () => true,
    count = 1,
    timeoutMs = 45000
) {
    const matching = () => events.filter(
        event => event.type === type && predicate(event)
    );

    if (matching().length >= count) {
        return Promise.resolve(matching().slice(0, count));
    }

    return new Promise((resolve, reject) => {
        const waiter = {
            timer: null,

            check() {
                const results = matching();

                if (results.length < count) return;

                clearTimeout(waiter.timer);
                waiters.splice(waiters.indexOf(waiter), 1);

                resolve(results.slice(0, count));
            },
        };

        waiter.timer = setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1);
            reject(new Error(`Timed out waiting for ${type}`));
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
        name,
        ws,
        events,
        audioPackets,
        opened,
        waitFor,
        waitForCount,
    };
}

async function connectParticipant(roomCode, participant) {
    const client = createRoomClient(participant.self.displayName);

    await client.opened;

    const joined = client.waitFor("room_joined");

    client.ws.send(JSON.stringify({
        type: "auth",
        roomCode,
        participantId: participant.self.id,
        token: participant.participantToken,
    }));

    await joined;

    return client;
}

async function streamPcm(client, pcm) {
    let frames = 0;

    for (let offset = 0; offset < pcm.length; offset += FRAME_BYTES) {
        let frame = pcm.subarray(offset, offset + FRAME_BYTES);

        if (frame.length < FRAME_BYTES) {
            const padded = Buffer.alloc(FRAME_BYTES);
            frame.copy(padded);
            frame = padded;
        }

        if (client.ws.readyState !== WebSocket.OPEN) {
            throw new Error("Room connection closed during streaming");
        }

        client.ws.send(frame, { binary: true });
        frames++;

        await new Promise(resolve =>
            setTimeout(resolve, FRAME_INTERVAL_MS)
        );
    }

    return frames;
}

async function main() {
    const participants = [];
    const clients = [];

    let roomCode = null;

    try {
        console.log("\n1. Creating a three-participant room...");

        const host = await apiRequest("/api/rooms", {
            method: "POST",
            body: JSON.stringify({
                displayName: "Punjabi Speaker",
                spokenLanguage: "pa-IN",
                preferredLanguage: "bn-IN",
            }),
        });

        participants.push(host);
        roomCode = host.room.roomCode;

        const tamilListener = await apiRequest(
            `/api/rooms/${roomCode}/join`,
            {
                method: "POST",
                body: JSON.stringify({
                    displayName: "Tamil Listener",
                    spokenLanguage: "ta-IN",
                    preferredLanguage: "ta-IN",
                }),
            }
        );

        participants.push(tamilListener);

        const hindiListener = await apiRequest(
            `/api/rooms/${roomCode}/join`,
            {
                method: "POST",
                body: JSON.stringify({
                    displayName: "Hindi Listener",
                    spokenLanguage: "hi-IN",
                    preferredLanguage: "hi-IN",
                }),
            }
        );

        participants.push(hindiListener);

        console.log("Room:", roomCode);

        console.log("\n2. Connecting all participants...");

        const hostClient = await connectParticipant(roomCode, host);
        clients.push(hostClient);

        const tamilClient = await connectParticipant(
            roomCode,
            tamilListener
        );
        clients.push(tamilClient);

        const hindiClient = await connectParticipant(
            roomCode,
            hindiListener
        );
        clients.push(hindiClient);

        console.log("\n3. Starting the speaker's Prisma session...");

        const sttReady = hostClient.waitFor("stt_ready");

        hostClient.ws.send(JSON.stringify({
            type: "start_audio",
        }));

        await sttReady;

        console.log("\n4. Streaming Punjabi speech...");

        const pcm = loadPcm(AUDIO_PATH);

        const tamilCompletions = tamilClient.waitForCount(
            "room_tts_complete",
            event => event.targetLanguage === "ta-IN",
            2
        );

        const hindiCompletions = hindiClient.waitForCount(
            "room_tts_complete",
            event => event.targetLanguage === "hi-IN",
            2
        );

        const frames = await streamPcm(hostClient, pcm);

        console.log("Frames streamed:", frames);

        hostClient.ws.send(JSON.stringify({
            type: "commit",
        }));

        console.log("\n5. Waiting for listener-specific synthesis...");

        const [tamilResults, hindiResults] = await Promise.all([
            tamilCompletions,
            hindiCompletions,
        ]);

        console.log("Tamil synthesis turns:", tamilResults.length);
        console.log("Hindi synthesis turns:", hindiResults.length);

        console.log("\n6. Checking audio isolation...");

        const speakerAudioCount = hostClient.audioPackets.length;

        const tamilWrongLanguage =
            tamilClient.audioPackets.filter(
                packet => packet.metadata.targetLanguage !== "ta-IN"
            ).length;

        const hindiWrongLanguage =
            hindiClient.audioPackets.filter(
                packet => packet.metadata.targetLanguage !== "hi-IN"
            ).length;

        console.log({
            speakerReceivedAudio: speakerAudioCount,
            tamilListenerChunks: tamilClient.audioPackets.length,
            hindiListenerChunks: hindiClient.audioPackets.length,
            tamilWrongLanguage,
            hindiWrongLanguage,
        });

        if (speakerAudioCount !== 0) {
            throw new Error("Speaker received their own generated audio");
        }

        if (tamilClient.audioPackets.length === 0) {
            throw new Error("Tamil listener received no audio");
        }

        if (hindiClient.audioPackets.length === 0) {
            throw new Error("Hindi listener received no audio");
        }

        if (tamilWrongLanguage || hindiWrongLanguage) {
            throw new Error("Audio was delivered to the wrong language group");
        }

        console.log("\n========== M8.3 PASSED ==========");
        console.log("Distinct target-language synthesis: passed");
        console.log("Tamil audio routing: passed");
        console.log("Hindi audio routing: passed");
        console.log("Speaker self-audio exclusion: passed");
        console.log("Listener language isolation: passed");

        // Give the STT session a clean shutdown.
        const stopped = hostClient.waitFor("stt_stopped");

        hostClient.ws.send(JSON.stringify({
            type: "stop_audio",
        }));

        await stopped;

    } finally {
        for (const client of clients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.close();
            }
        }

        // Delete all temporary test participants.
        for (const participant of participants) {
            if (!roomCode) break;

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
                // Ignore cleanup errors after a failed test.
            }
        }
    }
}

main().catch(error => {
    console.error("\nM8.3 TEST FAILED:", error.message);
    process.exitCode = 1;
});
