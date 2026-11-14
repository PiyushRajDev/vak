import "dotenv/config";
import fs from "node:fs";
import { createServer } from "node:http";
import WebSocket from "ws";
import app from "../src/app.js";
import { attachRoomSocket } from "../src/services/rooms/room-socket.js";
import { attachPrismaProxy } from "../src/services/stt/prisma-proxy.js";

process.env.VAK_TTS_TRACE = "1";

const PORT = 8012;
const API = `http://localhost:${PORT}`;
const WAV_PATH = process.argv[2] || "outputs/t2-c-punjabi-long-16k.wav";

function loadPcm16k(path) {
    const buffer = fs.readFileSync(path);
    if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
        throw new Error("Invalid WAV file");
    }
    let pcm = null, sampleRate = null, channels = null, bits = null;
    let offset = 12;
    while (offset + 8 <= buffer.length) {
        const id = buffer.toString("ascii", offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        const start = offset + 8;
        const end = Math.min(start + size, buffer.length);
        if (id === "fmt ") {
            channels = buffer.readUInt16LE(start + 2);
            sampleRate = buffer.readUInt32LE(start + 4);
            bits = buffer.readUInt16LE(start + 14);
        }
        if (id === "data") pcm = buffer.subarray(start, end);
        offset = start + size + (size % 2);
    }
    if (!pcm) throw new Error("No PCM data");
    if (sampleRate !== 16000 || channels !== 1 || bits !== 16) {
        throw new Error("Need mono 16kHz 16-bit PCM");
    }
    return pcm;
}

function computePayloadHash(buf) {
    const view = Buffer.isBuffer(buf) ? buf : new Uint8Array(buf);
    let h = 0;
    const limit = Math.min(view.length, 64);
    for (let i = 0; i < limit; i++) {
        h = (h * 31 + view[i]) >>> 0;
    }
    return h.toString(16);
}

function apiRequest(path, options = {}) {
    return fetch(`${API}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...options.headers },
    }).then(async r => {
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
        return data;
    });
}

// -------------------------------------------------------------
// TRACE COLLECTOR
// -------------------------------------------------------------
const traces = {
    generations: new Map(), // generationId -> info
    b1_generated: [],       // Boundary 1: chunkGenerated
    b2_sent: [],            // Boundary 2: chunkSent
    b3_received: [],        // Boundary 3: chunkReceived
    b4_started: [],         // Boundary 4: sourceStart
};

// Hook console.log to intercept TTS_TRACE from timbre.js and room-voice-router.js
const originalConsoleLog = console.log;
console.log = (...args) => {
    if (typeof args[0] === "string" && args[0].startsWith('{"t":"TTS_TRACE"')) {
        try {
            const tr = JSON.parse(args[0]);
            if (tr.event === "synthesisStarted") {
                traces.generations.set(tr.generationId, tr);
            } else if (tr.event === "chunkGenerated") {
                traces.b1_generated.push(tr);
            } else if (tr.event === "chunkSent") {
                traces.b2_sent.push(tr);
            }
        } catch {}
    }
    originalConsoleLog.apply(console, args);
};

// -------------------------------------------------------------
// MOCK WEB AUDIO (Mirrors browser RoomPresence playback)
// -------------------------------------------------------------
class MockAudioBuffer {
    constructor(channels, length, sampleRate) {
        this.duration = length / sampleRate;
        this.sampleRate = sampleRate;
        this.length = length;
    }
    copyToChannel() {}
}

class MockAudioBufferSourceNode {
    constructor(context) {
        this.context = context;
        this.buffer = null;
        this.onended = null;
    }
    connect() {}
    start(when) {
        // Schedule ended callback
        setTimeout(() => {
            if (typeof this.onended === "function") this.onended();
        }, Math.max(1, (this.buffer?.duration || 0.05) * 100)); // fast simulation
    }
}

class MockAudioContext {
    constructor() {
        this.sampleRate = 48000;
        this.currentTime = 0;
        this.state = "running";
        this.destination = {};
        // Advance clock periodically
        setInterval(() => { this.currentTime += 0.05; }, 50);
    }
    createBuffer(channels, length, sampleRate) {
        return new MockAudioBuffer(channels, length, sampleRate);
    }
    createBufferSource() {
        return new MockAudioBufferSourceNode(this);
    }
}

// -------------------------------------------------------------
// SIMULATED ROOM PRESENCE PLAYBACK ENGINE
// (EXACT logic from RoomPresence.tsx)
// -------------------------------------------------------------
class SimulatedRoomPresence {
    constructor(roomSession) {
        this.roomSession = roomSession;
        this.playbackContext = new MockAudioContext();
        this.nextPlaybackTime = 0;
        this.turnAudioBuffers = new Map();
        this.playingTurnId = null;
    }

    schedulePcmChunk(pcm, sampleRate, turnId, meta) {
        const context = this.playbackContext;
        if (!context || context.state !== "running") return;

        const sampleCount = pcm.byteLength / 2;
        const audioBuffer = context.createBuffer(1, sampleCount, sampleRate);
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);

        const startAt = Math.max(this.nextPlaybackTime, context.currentTime + 0.06);
        source.start(startAt);

        const scheduledEndTime = startAt + audioBuffer.duration;
        this.nextPlaybackTime = scheduledEndTime;

        const record = {
            t: "TTS_TRACE",
            event: "sourceStart",
            turnId: turnId || null,
            utteranceId: meta?.utteranceId || null,
            generationId: meta?.generationId || null,
            chunkIndex: meta?.chunkIndex ?? null,
            payloadHash: meta?.payloadHash || null,
            chunkDuration: Number(audioBuffer.duration.toFixed(4)),
            sourceStartTime: Number(startAt.toFixed(4)),
            scheduledEndTime: Number(scheduledEndTime.toFixed(4)),
            contextTime: Number(context.currentTime.toFixed(4)),
            ts: Date.now(),
        };
        traces.b4_started.push(record);
        originalConsoleLog(JSON.stringify(record));
    }

    drainTurnBuffer(turnId) {
        const turn = this.turnAudioBuffers.get(turnId);
        const context = this.playbackContext;
        if (!turn || !context || context.state !== "running") return;

        while (turn.chunks.has(turn.nextChunkIndex)) {
            const chunk = turn.chunks.get(turn.nextChunkIndex);
            if (!chunk) break;

            turn.chunks.delete(turn.nextChunkIndex);
            this.schedulePcmChunk(chunk.pcm, chunk.sampleRate, turnId, {
                utteranceId: chunk.utteranceId,
                generationId: chunk.generationId,
                chunkIndex: chunk.chunkIndex,
                payloadHash: chunk.payloadHash,
            });
            turn.nextChunkIndex++;
        }

        if (turn.complete && turn.chunks.size === 0) {
            this.turnAudioBuffers.delete(turnId);
        }
    }

    processRoomAudioPacket(data) {
        if (data.byteLength < 5) return;
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const headerLength = view.getUint32(0, false);
        if (headerLength === 0 || headerLength > 64 * 1024 || headerLength > data.byteLength - 4) return;

        const headerBytes = new Uint8Array(data.buffer, data.byteOffset + 4, headerLength);
        const headerText = new TextDecoder().decode(headerBytes);
        const metadata = JSON.parse(headerText);

        if (metadata.type !== "room_audio_chunk") return;
        if (metadata.roomCode !== this.roomSession.roomCode) return;
        if (metadata.targetLanguage !== this.roomSession.preferredLanguage) return;
        if (metadata.speakerId === this.roomSession.participantId) return;

        const pcmStart = 4 + headerLength;
        const pcm = data.buffer.slice(data.byteOffset + pcmStart, data.byteOffset + data.byteLength);
        const sampleRate = metadata.sampleRate ?? 48000;

        let turn = this.turnAudioBuffers.get(metadata.turnId);
        if (!turn) {
            turn = {
                nextChunkIndex: metadata.chunkIndex,
                chunks: new Map(),
                complete: false,
            };
            this.turnAudioBuffers.set(metadata.turnId, turn);
        }

        if (metadata.chunkIndex < turn.nextChunkIndex || turn.chunks.has(metadata.chunkIndex)) {
            return;
        }

        const payloadHash = computePayloadHash(pcm);
        const chunkDuration = (pcm.byteLength / 2) / sampleRate;

        const record = {
            t: "TTS_TRACE",
            event: "chunkReceived",
            turnId: metadata.turnId,
            utteranceId: metadata.utteranceId || null,
            generationId: metadata.generationId || null,
            chunkIndex: metadata.chunkIndex,
            payloadHash,
            chunkDuration: Number(chunkDuration.toFixed(4)),
            byteLength: pcm.byteLength,
            ts: Date.now(),
        };
        traces.b3_received.push(record);
        originalConsoleLog(JSON.stringify(record));

        turn.chunks.set(metadata.chunkIndex, {
            pcm,
            sampleRate,
            utteranceId: metadata.utteranceId,
            generationId: metadata.generationId,
            chunkIndex: metadata.chunkIndex,
            payloadHash,
        });

        this.drainTurnBuffer(metadata.turnId);
    }

    handleTtsComplete(message) {
        const turnId = message.turnId;
        if (typeof turnId === "string") {
            const turn = this.turnAudioBuffers.get(turnId);
            if (turn) {
                turn.complete = true;
                if (turn.chunks.size === 0) {
                    this.turnAudioBuffers.delete(turnId);
                }
            }
        }
    }
}

async function main() {
    console.log("=== STARTING DIAGNOSTIC TEST RUNNER ===");
    const server = createServer(app);
    attachPrismaProxy(server);
    attachRoomSocket(server);

    await new Promise(r => server.listen(PORT, "0.0.0.0", r));
    console.log(`Backend server listening on ${API}`);

    const pcm = loadPcm16k(WAV_PATH);
    console.log(`Loaded PCM: ${pcm.length} bytes (~${(pcm.length / 32000).toFixed(1)} s audio)`);

    // 1. Create Room & Participants
    const speakerData = { displayName: "Speaker", spokenLanguage: "pa-IN", preferredLanguage: "pa-IN" };
    const created = await apiRequest("/api/rooms/", { method: "POST", body: JSON.stringify(speakerData) });
    const roomCode = created.room.roomCode;
    const speakerToken = created.participantToken;
    const speakerId = created.self.id;

    const listenerData = { displayName: "Listener", spokenLanguage: "ta-IN", preferredLanguage: "ta-IN" };
    const joined = await apiRequest(`/api/rooms/${roomCode}/join`, { method: "POST", body: JSON.stringify(listenerData) });
    const listenerToken = joined.participantToken;
    const listenerId = joined.self.id;

    console.log(`Room created: ${roomCode}, Speaker: ${speakerId}, Listener: ${listenerId}`);

    const simPlayback = new SimulatedRoomPresence({
        roomCode,
        participantId: listenerId,
        preferredLanguage: "ta-IN",
    });

    // 2. Connect WebSockets
    const speakerWs = new WebSocket(`ws://localhost:${PORT}/ws/room`);
    const listenerWs = new WebSocket(`ws://localhost:${PORT}/ws/room`);

    await Promise.all([
        new Promise(r => speakerWs.on("open", r)),
        new Promise(r => listenerWs.on("open", r)),
    ]);

    speakerWs.send(JSON.stringify({ type: "auth", roomCode, participantId: speakerId, token: speakerToken }));
    listenerWs.send(JSON.stringify({ type: "auth", roomCode, participantId: listenerId, token: listenerToken }));

    let sttReady = false;
    speakerWs.on("message", (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === "stt_ready") sttReady = true;
        } catch {}
    });

    listenerWs.on("message", (raw, isBinary) => {
        if (isBinary) {
            simPlayback.processRoomAudioPacket(Buffer.from(raw));
            return;
        }
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === "room_tts_complete") {
                simPlayback.handleTtsComplete(msg);
            }
        } catch {}
    });

    // Wait for room ready
    await new Promise(r => setTimeout(r, 600));

    // 3. Start STT session
    speakerWs.send(JSON.stringify({ type: "start_audio" }));
    const tStart = Date.now();
    while (!sttReady && Date.now() - tStart < 15000) {
        await new Promise(r => setTimeout(r, 50));
    }
    if (!sttReady) throw new Error("STT failed to become ready");
    console.log("Speaker STT session ready");

    // 4. Stream Audio
    const FRAME_SIZE = 1024;
    console.log("Streaming audio frames...");
    for (let i = 0; i < pcm.length; i += FRAME_SIZE) {
        const frame = Buffer.alloc(FRAME_SIZE);
        pcm.copy(frame, 0, i, Math.min(i + FRAME_SIZE, pcm.length));
        speakerWs.send(frame);
        await new Promise(r => setTimeout(r, 32));
    }
    console.log("All audio frames sent. Sending commit...");
    speakerWs.send(JSON.stringify({ type: "commit" }));

    // 5. Wait for pipeline to complete
    console.log("Waiting for translation and TTS completion...");
    await new Promise(r => setTimeout(r, 35000));

    // 6. ANALYZE TRACES ACROSS FOUR BOUNDARIES
    console.log("\n=======================================================");
    console.log("             FOUR BOUNDARIES TRACE ANALYSIS            ");
    console.log("=======================================================");

    console.log(`TTS Generations initiated: ${traces.generations.size}`);
    for (const [genId, info] of traces.generations) {
        console.log(`  Generation ID: ${genId}, Text len: ${info.textLength}, Lang: ${info.language}`);
    }

    console.log(`\nBoundary 1 (TTS chunks generated): ${traces.b1_generated.length}`);
    console.log(`Boundary 2 (Backend chunks sent):     ${traces.b2_sent.length}`);
    console.log(`Boundary 3 (Frontend chunks received): ${traces.b3_received.length}`);
    console.log(`Boundary 4 (Source nodes started):     ${traces.b4_started.length}`);

    // Check for duplicate chunkIndex or payloadHash at each boundary
    function checkBoundaryDups(items, name, keyFn) {
        const counts = new Map();
        const dupList = [];
        for (const it of items) {
            const key = keyFn(it);
            counts.set(key, (counts.get(key) || 0) + 1);
            if (counts.get(key) === 2) {
                dupList.push(key);
            }
        }
        console.log(`\nChecking ${name}:`);
        console.log(`  Total items: ${items.length}, Distinct keys: ${counts.size}, Duplicates: ${dupList.length}`);
        if (dupList.length > 0) {
            console.log(`  FIRST 5 DUPLICATES IN ${name}:`, dupList.slice(0, 5));
        }
        return dupList;
    }

    const d1 = checkBoundaryDups(traces.b1_generated, "Boundary 1 (TTS Generated)", x => `${x.generationId}#${x.chunkIndex}`);
    const d2 = checkBoundaryDups(traces.b2_sent, "Boundary 2 (WebSocket Sent)", x => `${x.turnId}#${x.chunkIndex}`);
    const d3 = checkBoundaryDups(traces.b3_received, "Boundary 3 (WebSocket Received)", x => `${x.turnId}#${x.chunkIndex}`);
    const d4 = checkBoundaryDups(traces.b4_started, "Boundary 4 (AudioSource Started)", x => `${x.turnId}#${x.chunkIndex}`);

    // Compare payload hashes across boundaries
    console.log("\n=== CROSS-BOUNDARY CHUNK INDEX & HASH COMPARISON ===");
    const sampleIndices = [1, 5, 10, 20, 50].filter(i => i <= traces.b1_generated.length);
    for (const idx of sampleIndices) {
        const c1 = traces.b1_generated.find(c => c.chunkIndex === idx);
        const c2 = traces.b2_sent.find(c => c.chunkIndex === idx);
        const c3 = traces.b3_received.find(c => c.chunkIndex === idx);
        const c4 = traces.b4_started.find(c => c.chunkIndex === idx);
        console.log(`Chunk #${idx}:`);
        console.log(`  B1 (Gen):  hash=${c1?.payloadHash} dur=${c1?.chunkDurationSeconds}s`);
        console.log(`  B2 (Sent): hash=${c2?.payloadHash} dur=${c2?.chunkDurationSeconds}s`);
        console.log(`  B3 (Recv): hash=${c3?.payloadHash} dur=${c3?.chunkDuration}s`);
        console.log(`  B4 (Play): hash=${c4?.payloadHash} start=${c4?.sourceStartTime}s end=${c4?.scheduledEndTime}s`);
    }

    speakerWs.close();
    listenerWs.close();
    server.close();
    console.log("\n=== DIAGNOSTIC FINISHED ===");
}

main().catch(err => {
    console.error("DIAGNOSTIC FAILED:", err);
    process.exit(1);
});
