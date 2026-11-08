
import "dotenv/config";
import WebSocket from "ws";
import { performance } from "node:perf_hooks";
import readline from "node:readline/promises";

const API_KEY = process.env.GNANI_API_KEY_ID;
const ENDPOINT = "wss://api.vachana.ai/stt/v3/stream";

const SAMPLE_RATE = 16000;
const FRAME_BYTES = 1024;
const FRAME_DURATION_MS = 32;
const TEST_DURATION_MS = 30000;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

function send(ws, frame) {
    return new Promise((resolve, reject) => {
        ws.send(frame, { binary: true }, error => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function ask(question) {
    return rl.question(question);
}

async function main() {
    if (!API_KEY) {
        throw new Error("GNANI_API_KEY_ID missing");
    }

    const before = await ask(
        "Credit balance BEFORE silence test: "
    );

    const ws = new WebSocket(ENDPOINT, {
        handshakeTimeout: 15000,
        headers: {
            "x-api-key-id": API_KEY,
            "model": "prisma-v3.0",
            "language_code": "pa-IN",
            "format": "transcribe",
            "x-sample-rate": String(SAMPLE_RATE),
            "x-idle-timeout-sec": "60",
            "x-vad-threshold": "0.7",
            "x-min-speech-ms": "200",
            "x-min-silence-ms": "500",
        },
    });

    const messages = [];
    let connectedConfig = null;

    let resolveConnected;
    let rejectConnected;

    const connectedPromise = new Promise((resolve, reject) => {
        resolveConnected = resolve;
        rejectConnected = reject;
    });

    ws.on("message", raw => {
        try {
            const message = JSON.parse(raw.toString());

            messages.push(message);

            if (message.type === "connected") {
                connectedConfig = message.config;
                resolveConnected(message);
            }

            if (message.type === "error") {
                console.error(
                    "[Prisma error]",
                    message.message
                );

                if (!connectedConfig) {
                    rejectConnected(
                        new Error(message.message)
                    );
                }
            }

            if (message.type === "transcript") {
                console.warn(
                    "[Unexpected transcript]",
                    message.text
                );
            }
        } catch (error) {
            console.error("Invalid response", error);
        }
    });

    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error("Connection timeout")),
                15000
            );

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
                        `HTTP ${res.statusCode}: ${body}`
                    ));
                });
            });

            ws.once("error", error => {
                clearTimeout(timer);
                reject(error);
            });
        });

        await Promise.race([
            connectedPromise,
            sleep(15000).then(() => {
                throw new Error("No Prisma connected event");
            }),
        ]);

        console.log("Prisma connected:", connectedConfig);

        // Signed 16-bit little-endian PCM silence.
        const silenceFrame = Buffer.alloc(FRAME_BYTES);

        const frameCount = Math.ceil(
            TEST_DURATION_MS / FRAME_DURATION_MS
        );

        const startedAt = performance.now();

        console.log(
            `Sending ${frameCount} silence frames for approximately 30 seconds...`
        );

        for (let i = 0; i < frameCount; i++) {
            if (ws.readyState !== WebSocket.OPEN) {
                throw new Error("STT connection closed during silence test");
            }

            await send(ws, silenceFrame);

            const nextTime =
                startedAt + (i + 1) * FRAME_DURATION_MS;

            await sleep(
                Math.max(0, nextTime - performance.now())
            );

            if ((i + 1) % 100 === 0) {
                console.log(
                    `Sent ${i + 1}/${frameCount} frames`
                );
            }
        }

        const elapsedMs = Math.round(
            performance.now() - startedAt
        );

        console.log("\nSilence transmission completed:", elapsedMs, "ms");

        // Give the service a brief time to report any delayed event.
        await sleep(1500);

        console.log("\nMessage types received:");

        const counts = {};

        for (const message of messages) {
            counts[message.type] =
                (counts[message.type] || 0) + 1;
        }

        console.table(
            Object.entries(counts).map(
                ([type, count]) => ({ type, count })
            )
        );

        console.log(
            "Transcripts generated:",
            messages.filter(
                message => message.type === "transcript"
            ).length
        );

    } finally {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }

        await sleep(500);

        const after = await ask(
            "\nCredit balance AFTER silence test: "
        );

        console.log("\n========== T6 RESULTS ==========");

        if (
            before.trim() !== "" &&
            after.trim() !== "" &&
            Number.isFinite(Number(before)) &&
            Number.isFinite(Number(after))
        ) {
            console.log({
                before: Number(before),
                after: Number(after),
                observedCreditConsumption:
                    Number(before) - Number(after),
            });
        } else {
            console.log(
                "Balance comparison unavailable."
            );
        }
    }
}

main()
    .catch(error => {
        console.error("\nT6 FAILED:", error.message);
        process.exitCode = 1;
    })
    .finally(() => rl.close());
