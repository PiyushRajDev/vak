
import "dotenv/config";
import WebSocket from "ws";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import readline from "node:readline/promises";

const API_KEY = process.env.GNANI_API_KEY_ID;
const WS_URL = "wss://api.vachana.ai/api/v1/tts";
const REST_URL = "https://api.vachana.ai/api/v1/tts/inference";

const payload = {
    text: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਇਹ Vāk ਦੀ ਸਮਕਾਲੀ ਜਾਂਚ ਹੈ।",
    voice: "Devansh",
    model: "timbre-v3.0",
    language: "pa-IN",
    speed: 1.0,
    audio_config: {
        sample_rate: 48000,
        num_channels: 1,
        sample_width: 2,
        encoding: "linear_pcm",
        container: "raw",
    },
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const sleep = (ms) =>
    new Promise(resolve => setTimeout(resolve, ms));

function createWavHeader(size) {
    const header = Buffer.alloc(44);

    header.write("RIFF", 0);
    header.writeUInt32LE(36 + size, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(48000, 24);
    header.writeUInt32LE(96000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(size, 40);

    return header;
}

async function openSocket(id) {
    const ws = new WebSocket(WS_URL, {
        handshakeTimeout: 15000,
        headers: {
            "X-API-Key-ID": API_KEY,
        },
    });

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${id}: connection timeout`));
        }, 15000);

        ws.once("open", () => {
            clearTimeout(timer);
            resolve();
        });

        ws.once("unexpected-response", (req, res) => {
            clearTimeout(timer);

            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => {
                reject(new Error(
                    `${id}: HTTP ${res.statusCode}: ${body}`
                ));
            });
        });

        ws.once("error", error => {
            clearTimeout(timer);
            reject(error);
        });
    });

    return ws;
}

function runWsRequest(ws, id, filename) {
    return new Promise(resolve => {
        const startedAt = performance.now();
        const chunks = [];
        let chunkCount = 0;
        let finished = false;

        const finish = async (status, details = {}) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);

            let audioBytes = 0;

            if (status === 200) {
                const pcm = Buffer.concat(chunks);
                audioBytes = pcm.length;

                await mkdir("outputs", { recursive: true });

                await writeFile(
                    resolvePath(filename),
                    Buffer.concat([
                        createWavHeader(pcm.length),
                        pcm,
                    ])
                );
            }

            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }

            resolve({
                id,
                transport: "WebSocket",
                status,
                latencyMs: Math.round(
                    performance.now() - startedAt
                ),
                chunkCount,
                audioBytes,
                ...details,
            });
        };

        const timer = setTimeout(() => {
            finish("TIMEOUT", {
                error: "No completion event",
            });
            ws.terminate();
        }, 120000);

        ws.on("message", raw => {
            let message;

            try {
                message = JSON.parse(raw.toString());
            } catch {
                finish("INVALID_RESPONSE");
                return;
            }

            if (message.type === "audio") {
                const audio = Buffer.from(
                    message.data.audio,
                    "base64"
                );

                chunks.push(audio);
                chunkCount++;
            }

            if (message.type === "error") {
                finish("WS_ERROR", {
                    error: message.message,
                });
            }

            if (message.type === "complete") {
                finish(200);
            }
        });

        ws.on("error", error => {
            finish("WS_ERROR", {
                error: error.message,
            });
        });

        ws.send(JSON.stringify(payload));
    });
}

function resolvePath(filename) {
    return resolve("outputs", filename);
}

async function runRestRequest(id) {
    const startedAt = performance.now();

    try {
        const response = await fetch(REST_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key-ID": API_KEY,
            },
            body: JSON.stringify({
                ...payload,
                audio_config: {
                    ...payload.audio_config,
                    container: "wav",
                },
            }),
            signal: AbortSignal.timeout(120000),
        });

        const latencyMs = Math.round(
            performance.now() - startedAt
        );

        if (!response.ok) {
            return {
                id,
                transport: "REST",
                status: response.status,
                latencyMs,
                error: await response.text(),
            };
        }

        const audio = Buffer.from(
            await response.arrayBuffer()
        );

        await mkdir("outputs", { recursive: true });
        await writeFile(
            resolve("outputs/t5b-rest.wav"),
            audio
        );

        return {
            id,
            transport: "REST",
            status: response.status,
            latencyMs,
            audioBytes: audio.length,
        };
    } catch (error) {
        return {
            id,
            transport: "REST",
            status: "NETWORK_ERROR",
            error: error.message,
        };
    }
}

async function runPhase(label, execute) {
    console.log(`\n========== ${label} ==========`);

    await rl.question(
        "Refresh credit balance, then press ENTER to continue: "
    );

    const before = await rl.question(
        "Credit balance before this phase: "
    );

    const results = await execute();

    console.table(results);

    const after = await rl.question(
        "Credit balance after this phase: "
    );

    if (
        before.trim() !== "" &&
        after.trim() !== "" &&
        Number.isFinite(Number(before)) &&
        Number.isFinite(Number(after))
    ) {
        console.log(
            "Observed credit change:",
            Number(before) - Number(after)
        );
    }

    return results;
}

async function main() {
    if (!API_KEY) {
        throw new Error("GNANI_API_KEY_ID is missing");
    }

    // Phase A: two WebSocket synthesis requests.
    const phaseA = await runPhase(
        "T5b-A: TWO WEBSOCKET REQUESTS",
        async () => {
            const sockets = await Promise.all([
                openSocket("WS-1"),
                openSocket("WS-2"),
            ]);

            console.log("Both sockets opened.");

            return Promise.all([
                runWsRequest(
                    sockets[0],
                    "WS-1",
                    "t5b-ws-1.wav"
                ),
                runWsRequest(
                    sockets[1],
                    "WS-2",
                    "t5b-ws-2.wav"
                ),
            ]);
        }
    );

    // Phase B: one WebSocket and one REST request.
    const phaseB = await runPhase(
        "T5b-B: WEBSOCKET + REST",
        async () => {
            const socket = await openSocket("MIXED-WS");

            console.log(
                "WebSocket opened. Launching both synthesis requests."
            );

            return Promise.all([
                runWsRequest(
                    socket,
                    "MIXED-WS",
                    "t5b-mixed-ws.wav"
                ),
                runRestRequest("MIXED-REST"),
            ]);
        }
    );

    console.log("\n========== T5b FINAL ==========");
    console.log("Two WebSockets:");
    console.table(phaseA);
    console.log("WebSocket + REST:");
    console.table(phaseB);
}

main()
    .catch(error => {
        console.error("T5b FAILED:", error.message);
        process.exitCode = 1;
    })
    .finally(() => rl.close());
