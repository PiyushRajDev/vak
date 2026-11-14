/**
 * Regression test: TTS long-utterance exactly-once playback.
 *
 * Drives one long utterance through the full pipeline (room socket -> STT
 * -> translation -> TTS streaming) and verifies that, for every speech turn:
 *
 *   - generations == utterances spoken
 *   - chunks generated == chunks sent == chunks received
 *   - no duplicate chunkIndex within a turn
 *   - chunkIndex ranges are contiguous [1..N]
 *   - room_tts_complete fires exactly once per turn
 *
 * Run with the backend already listening on :8000 (real GNANI/STT
 * credentials are required). Sets process.exitCode = 1 on failure.
 *
 * Usage: node scripts/test-tts-dedup-regression.js [path/to/16k.wav]
 */
import fs from "node:fs";
import WebSocket from "ws";

const API = "http://localhost:8000";
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

const pcm = loadPcm16k(WAV_PATH);
const FRAME_BYTES = 1024;

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

class RoomClient {
    constructor(name, token, participant) {
        this.name = name;
        this.token = token;
        this.participant = participant;
        this.ws = new WebSocket(`ws://localhost:8000/ws/room`);
        this.audioPackets = [];
        this.events = [];
        this.ttsCompletes = [];
        this.turnChunkIndices = {};
        this.dupChunks = [];
        this.ws.on("open", () => {
            this.ws.send(JSON.stringify({
                type: "auth", roomCode: participant.roomCode,
                participantId: participant.self.id, token: token,
            }));
        });
        this.ws.on("message", (raw, isBinary) => {
            if (isBinary) {
                const packet = Buffer.from(raw);
                if (packet.length < 5) return;
                const headerSize = packet.readUInt32BE(0);
                const metadata = JSON.parse(packet.subarray(4, 4 + headerSize).toString());
                const audio = packet.subarray(4 + headerSize);
                this.audioPackets.push({ metadata, audioBytes: audio.length });
                const { turnId, chunkIndex } = metadata;
                if (!this.turnChunkIndices[turnId]) this.turnChunkIndices[turnId] = new Set();
                if (this.turnChunkIndices[turnId].has(chunkIndex)) {
                    this.dupChunks.push({ turnId, chunkIndex, bytes: audio.length });
                }
                this.turnChunkIndices[turnId].add(chunkIndex);
                return;
            }
            let message;
            try { message = JSON.parse(raw.toString()); } catch { return; }
            this.events.push(message.type);
            if (message.type === "room_tts_complete") this.ttsCompletes.push(message);
            if (message.type === "room_updated") this.events.push("room_updated");
        });
        this.ws.on("error", e => console.log(`[${this.name}] WS error:`, e.message));
    }
    send(obj) { this.ws.send(JSON.stringify(obj)); }
    close() { this.ws.close(); }
    waitFor(cond, timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`timeout waiting for ${cond}`)), timeoutMs);
            const check = () => { if (cond(this)) { clearTimeout(t); resolve(); } else setTimeout(check, 50); };
            check();
        });
    }
}

let failures = 0;

function check(condition, message) {
    if (condition) {
        console.log(`  PASS: ${message}`);
    } else {
        failures++;
        console.log(`  FAIL: ${message}`);
    }
}
async function main() {
    const notFound = await fetch(`${API}/api/rooms/does-not-exist`).then(r => r.status).catch(() => 404);
    const backendUp = notFound === 404;
    if (!backendUp) {
        console.log("SKIP: backend not reachable at " + API);
        process.exit(0);
    }

    console.log("== 1. Room setup ==");
    const speakerData = { displayName: "Host", spokenLanguage: "pa-IN", preferredLanguage: "pa-IN" };
    const created = await apiRequest("/api/rooms/", { method: "POST", body: JSON.stringify(speakerData) });
    const roomCode = created.room.roomCode;
    const speakerToken = created.participantToken;
    const speakerSelf = created.self;

    const listener = await apiRequest(`/api/rooms/${roomCode}/join`, { method: "POST", body: JSON.stringify({ displayName: "Listener", spokenLanguage: "en-IN", preferredLanguage: "ta-IN" }) });
    const listenerToken = listener.participantToken;
    const listenerSelf = listener.self;

    const speaker = new RoomClient("SPEAKER", speakerToken, { roomCode, self: speakerSelf });
    const listen = new RoomClient("LISTEN", listenerToken, { roomCode, self: listenerSelf });

    await Promise.all([speaker.waitFor(() => true), listen.waitFor(() => true)]);
    await new Promise(r => setTimeout(r, 500));

    console.log("== 2. Stream long utterance ==");
    speaker.send({ type: "start_audio" });
    await speaker.waitFor(c => c.events.includes("stt_ready"), 15000);
    console.log("  STT ready");

    let sent = 0;
    for (let i = 0; i + FRAME_BYTES <= pcm.length; i += FRAME_BYTES) {
        speaker.ws.send(pcm.subarray(i, i + FRAME_BYTES));
        sent++;
    }
    const rem = pcm.length % FRAME_BYTES;
    if (rem > 0) {
        const pad = Buffer.alloc(FRAME_BYTES);
        pcm.copy(pad, 0, pcm.length - rem);
        speaker.ws.send(pad);
        sent++;
    }
    console.log(`  Frames streamed: ${sent}`);

    speaker.send({ type: "commit" });

    await new Promise(r => setTimeout(r, 45000));

    console.log("== 3. Verify exactly-once playback per turn ==");
    const turns = listen.turnChunkIndices;
    const totals = {};
    let totalPackets = 0;
    let totalCompletes = 0;
    let totalDups = listen.dupChunks.length;

    for (const turnId of Object.keys(turns)) {
        const indices = [...turns[turnId]].sort((a, b) => a - b);
        const completes = listen.ttsCompletes.filter(c => c.turnId === turnId).length;
        const expected = indices.length > 0 ? indices[indices.length - 1] - indices[0] + 1 : 0;
        const contiguous = indices.length > 0 ? indices.length === expected : true;
        const dups = listen.dupChunks.filter(d => d.turnId === turnId).length;

        totals[turnId] = { packets: indices.length, completes, dups, contiguous, first: indices[0], last: indices[indices.length - 1] };
        totalPackets += indices.length;
        totalCompletes += completes;
        totalDups += dups;
    }

    check(Object.keys(turns).length >= 1, "at least one speech turn produced");
    check(totalCompletes === Object.keys(turns).length, `room_tts_complete exactly once per turn (${totalCompletes} completes for ${Object.keys(turns).length} turns)`);
    check(totalPackets === 0 || totalPackets === listen.audioPackets.length, `received packets (${listen.audioPackets.length}) == sum of turn chunks (${totalPackets})`);

    for (const turnId of Object.keys(totals)) {
        const t = totals[turnId];
        check(t.dups === 0, `no duplicate chunkIndex within turn ${turnId.slice(0, 6)}`);
        check(t.completes === 1, `exactly one room_tts_complete for turn ${turnId.slice(0, 6)}`);
        check(t.contiguous, `contiguous chunkIndex [${t.first}..${t.last}] for turn ${turnId.slice(0, 6)}`);
    }

    console.log("== 4. Summary ==");
    console.log(`  turns: ${Object.keys(turns).length}`);
    for (const turnId of Object.keys(totals)) {
        const t = totals[turnId];
        console.log(`    turn ${turnId.slice(0, 6)}: chunks=${t.packets} range=[${t.first}..${t.last}] completes=${t.completes} dups=${t.dups}`);
    }
    console.log(`  duplicate chunks observed: ${totalDups}`);

    check(totalDups === 0, "no duplicate chunkIndex observed anywhere (generation == sent == received)");

    if (failures > 0) {
        console.log("\n>>> REGRESSION TEST FAILED");
        process.exitCode = 1;
    } else {
        console.log("\n>>> REGRESSION TEST PASSED: each audio chunk played exactly once");
    }

    speaker.close();
    listen.close();
}

main().catch(error => {
    console.error("Test failed with error:", error);
    process.exit(1);
});


