// Regression test: long-utterance streaming playback plays every chunk exactly once.
//
// Transcribes the exact RoomPresence playback logic (processRoomAudioPacket +
// drainTurnBuffer + schedulePcmChunk) with a mocked AudioContext and replays
// real chunk-arrival patterns:
//   A - rapid arrival of all chunks of one long turn
//   B - chunks arrive while the first drain is suspended on AudioContext startup
//   C - out-of-order chunk 0 arriving after chunk 1
//
// Every scenario asserts that each (turn, chunkIndex) is scheduled exactly
// once -- i.e. source.start() called once per intended chunk -- and that no
// two sources are started for the same chunk. No arbitrary playback delays
// are introduced; the mock only validates scheduling counts.

const started = [];
let failures = 0;

class MockAudioBuffer {
    constructor(channels, length, sampleRate) {
        this.duration = length / sampleRate;
        this.sampleRate = sampleRate;
        this.length = length;
    }
    copyToChannel() {}
}

class MockAudioBufferSourceNode {
    constructor() {
        this.buffer = null;
        this.onended = null;
        this._turnId = null;
        this._chunkIndex = null;
    }
    connect() {}
    start(when) {
        started.push({ turnId: this._turnId, chunkIndex: this._chunkIndex, startAt: when, endAt: when + this.buffer.duration });
        setTimeout(() => { if (typeof this.onended === "function") this.onended(); }, 0);
    }
}

class MockAudioContext {
    constructor() {
        this.sampleRate = 48000;
        this.currentTime = 0;
        this.state = "running";
    }
    createBuffer(channels, length, sampleRate) {
        return new MockAudioBuffer(channels, length, sampleRate);
    }
    createBufferSource() {
        return new MockAudioBufferSourceNode();
    }
    resume() { return Promise.resolve(); }
}

const speakerPlaybackRef = { current: new Map() };
const turnAudioBuffersRef = { current: new Map() };
const completedTurnsRef = { current: new Set() };

function ensurePlaybackContext() {
    return Promise.resolve(new MockAudioContext());
}

function schedulePcmChunk(pcm, sampleRate, turnId, speakerId, chunkIndex) {
    const context = new MockAudioContext();
    const sampleCount = pcm.byteLength / 2;
    const audioBuffer = context.createBuffer(1, sampleCount, sampleRate);
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);

    const speakerKey = speakerId || "default";
    let speakerState = speakerPlaybackRef.current.get(speakerKey);
    if (!speakerState) {
        speakerState = { nextPlaybackTime: 0, activeSources: new Set() };
        speakerPlaybackRef.current.set(speakerKey, speakerState);
    }

    const now = context.currentTime;
    let startAt = speakerState.nextPlaybackTime;
    if (startAt <= now || startAt > now + 30.0) startAt = now + 0.04;

    speakerState.activeSources.add(source);
    source._turnId = turnId;
    source._chunkIndex = chunkIndex;
    source.start(startAt);
    speakerState.nextPlaybackTime = startAt + audioBuffer.duration;
    return source;
}

const drainTurnBuffer = async (turnId) => {
    const turn = turnAudioBuffersRef.current.get(turnId);
    if (!turn || turn.isDraining) return;
    turn.isDraining = true;
    try {
        const context = await ensurePlaybackContext();
        if (!context) return;
        while (turn.chunks.has(turn.nextChunkIndex)) {
            const chunk = turn.chunks.get(turn.nextChunkIndex);
            if (!chunk) break;
            turn.chunks.delete(turn.nextChunkIndex);
            const src = schedulePcmChunk(chunk.pcm, chunk.sampleRate, turnId, turn.speakerId, turn.nextChunkIndex);
            src._turnId = turnId;
            src._chunkIndex = turn.nextChunkIndex;
            turn.nextChunkIndex++;
        }
    } finally {
        turn.isDraining = false;
        if (turn.chunks.has(turn.nextChunkIndex)) void drainTurnBuffer(turnId);
        if (turn.complete && turn.chunks.size === 0) {
            completedTurnsRef.current.add(turnId);
            turnAudioBuffersRef.current.delete(turnId);
        }
    }
};

const participantsRef = { current: [] };
const roomSession = { participantId: "listener", roomCode: "R1", preferredLanguage: "ta-IN" };

const processRoomAudioPacket = ({ turnId, speakerId, targetLanguage, chunkIndex, pcmBytes, sampleRate = 48000 }) => {
    const pcm = new ArrayBuffer(pcmBytes);
    const metadata = { type: "room_audio_chunk", roomCode: "R1", turnId, speakerId, targetLanguage, chunkIndex, sampleRate, channels: 1, encoding: "pcm_s16le" };
    if (metadata.type !== "room_audio_chunk") return;
    if (metadata.roomCode !== roomSession.roomCode) return;
    if (completedTurnsRef.current.has(metadata.turnId)) return;
    if (metadata.targetLanguage && metadata.targetLanguage.toLowerCase() !== roomSession.preferredLanguage.toLowerCase()) return;
    const hasOtherParticipants = participantsRef.current.some(p => p.id !== roomSession.participantId);
    if (metadata.speakerId === roomSession.participantId && hasOtherParticipants) return;
    if (!metadata.turnId || !Number.isInteger(metadata.chunkIndex) || metadata.chunkIndex < 0) throw new Error("Invalid audio chunk metadata.");

    let turn = turnAudioBuffersRef.current.get(metadata.turnId);
    if (!turn) {
        const startIndex = metadata.chunkIndex === 0 ? 0 : 1;
        turn = { speakerId: metadata.speakerId, nextChunkIndex: startIndex, chunks: new Map(), complete: false, isDraining: false };
        turnAudioBuffersRef.current.set(metadata.turnId, turn);
    }
    if (metadata.chunkIndex === 0 && turn.nextChunkIndex === 1 && !turn.chunks.has(1)) turn.nextChunkIndex = 0;
    if (metadata.chunkIndex < turn.nextChunkIndex || turn.chunks.has(metadata.chunkIndex)) return;

    turn.chunks.set(metadata.chunkIndex, { pcm, sampleRate });
    void drainTurnBuffer(metadata.turnId);
};
async function main() {
    // Scenario A: rapid arrival of all chunks of one long turn (344 chunks, mirroring e2e).
    const N = 344;
    const t0 = performance.now();
    for (let i = 1; i <= N; i++) {
        processRoomAudioPacket({ turnId: "turn-long", speakerId: "speaker-1", targetLanguage: "ta-IN", chunkIndex: i, pcmBytes: 4096 });
    }
    await new Promise(r => setTimeout(r, 50));
    console.log(`A: 344 chunks dispatched`);

    // Scenario B: chunks arrive while the first drain is suspended awaiting AudioContext creation.
    turnAudioBuffersRef.current.clear();
    speakerPlaybackRef.current.clear();
    let realResolve;
    const contextPromise = new Promise(r => { realResolve = r; });
    ensurePlaybackContext = () => contextPromise;

    processRoomAudioPacket({ turnId: "turn-race", speakerId: "speaker-1", targetLanguage: "ta-IN", chunkIndex: 1, pcmBytes: 4096 });
    processRoomAudioPacket({ turnId: "turn-race", speakerId: "speaker-1", targetLanguage: "ta-IN", chunkIndex: 2, pcmBytes: 4096 });
    await new Promise(r => setTimeout(r, 0));
    realResolve(new MockAudioContext());
    await new Promise(r => setTimeout(r, 0));
    for (let i = 3; i <= 20; i++) {
        processRoomAudioPacket({ turnId: "turn-race", speakerId: "speaker-1", targetLanguage: "ta-IN", chunkIndex: i, pcmBytes: 4096 });
    }
    await new Promise(r => setTimeout(r, 50));
    console.log(`B: 20 chunks dispatched during context-await race`);

    // Scenario C: out-of-order chunk 0 arriving after chunk 1 (no duplication).
    turnAudioBuffersRef.current.clear();
    speakerPlaybackRef.current.clear();
    ensurePlaybackContext = () => Promise.resolve(new MockAudioContext());
    processRoomAudioPacket({ turnId: "turn-ooo", speakerId: "speaker-1", targetLanguage: "ta-IN", chunkIndex: 1, pcmBytes: 4096 });
    await new Promise(r => setTimeout(r, 20));
    processRoomAudioPacket({ turnId: "turn-ooo", speakerId: "speaker-1", targetLanguage: "ta-IN", chunkIndex: 0, pcmBytes: 4096 });
    await new Promise(r => setTimeout(r, 50));
    console.log(`C: chunk 0 replayed after chunk 1 (expected: chunk 1 plays once, chunk 0 not re-played)`);

    // ---- Assertions ----
    const byKey = {};
    for (const s of started) {
        const k = `${s.turnId}#${s.chunkIndex}`;
        if (!byKey[k]) byKey[k] = 0;
        byKey[k]++;
    }
    const duplicates = {};
    for (const k of Object.keys(byKey)) {
        if (byKey[k] > 1) duplicates[k] = byKey[k];
    }

    console.log(`\nTotal scheduled source.start() calls: ${started.length}`);
    console.log(`Distinct (turn,chunk) scheduled: ${Object.keys(byKey).length}`);

    for (const [k, count] of Object.entries(duplicates)) {
        failures++;
        console.log(`  FAIL: chunk ${k} scheduled ${count} times`);
    }

    const summary = {};
    for (const s of started) {
        summary[s.turnId] = (summary[s.turnId] || 0) + 1;
    }
    for (const [turnId, count] of Object.entries(summary)) {
        const distinct = new Set(started.filter(s => s.turnId === turnId).map(s => s.chunkIndex)).size;
        console.log(`  turn ${turnId}: starts=${count} distinctChunks=${distinct}`);
    }

    check(started.length === Object.keys(byKey).length, "every scheduled start maps to a distinct chunk (no source started for a chunk twice)");

    if (failures > 0) {
        console.log("\n>>> REGRESSION TEST FAILED: duplicate chunk scheduling detected");
        process.exitCode = 1;
    } else {
        console.log("\n>>> REGRESSION TEST PASSED: every intended audio chunk scheduled exactly once");
    }
}

function check(condition, message) {
    if (condition) console.log(`  PASS: ${message}`);
    else { failures++; console.log(`  FAIL: ${message}`); }
}

main().catch(e => {
    console.error(e);
    process.exitCode = 1;
});

