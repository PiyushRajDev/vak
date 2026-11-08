
import "dotenv/config";
import WebSocket from "ws";
import { performance } from "node:perf_hooks";

const API_KEY = process.env.GNANI_API_KEY_ID;
const ENDPOINT = "wss://api.vachana.ai/stt/v3/stream";

const CONNECTION_COUNT = 4;

const wait = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

function connectProbe(id) {
    return new Promise((resolve) => {
        const startedAt = performance.now();

        const ws = new WebSocket(ENDPOINT, {
            handshakeTimeout: 12000,
            headers: {
                "x-api-key-id": API_KEY,
                "model": "prisma-v3.0",
                "language_code": "pa-IN",
                "format": "transcribe",
                "x-sample-rate": "16000",
                "x-idle-timeout-sec": "60",
            },
        });

        let settled = false;

        function finish(status, details = {}) {
            if (settled) return;
            settled = true;

            clearTimeout(timer);

            resolve({
                id,
                status,
                latencyMs: Math.round(
                    performance.now() - startedAt
                ),
                ...details,
                ws,
            });
        }

        const timer = setTimeout(() => {
            finish("TIMEOUT", {
                error: "No connection confirmation received",
            });

            ws.terminate();
        }, 15000);

        ws.on("message", (raw) => {
            let message;

            try {
                message = JSON.parse(raw.toString());
            } catch {
                return;
            }

            if (message.type === "connected") {
                finish("CONNECTED", {
                    config: message.config,
                });
            }

            if (message.type === "error") {
                finish("SERVER_ERROR", {
                    error: message.message,
                });
            }
        });

        ws.on("unexpected-response", (req, res) => {
            let body = "";

            res.on("data", (chunk) => {
                body += chunk;
            });

            res.on("end", () => {
                finish("HTTP_REJECTED", {
                    httpStatus: res.statusCode,
                    error: body,
                });
            });
        });

        ws.on("close", (code, reason) => {
            finish("CLOSED", {
                closeCode: code,
                reason: reason.toString(),
            });
        });

        ws.on("error", (error) => {
            finish("CONNECTION_ERROR", {
                error: error.message,
            });
        });
    });
}

async function main() {
    if (!API_KEY) {
        throw new Error("GNANI_API_KEY_ID missing");
    }

    const established = [];
    const results = [];

    try {
        console.log("T5: Testing four concurrent Prisma sessions");

        for (let i = 1; i <= 3; i++) {
            console.log(`\nOpening STT connection ${i}...`);

            const result = await connectProbe(i);

            results.push(result);

            console.log({
                id: result.id,
                status: result.status,
                latencyMs: result.latencyMs,
                error: result.error || null,
            });

            if (result.status !== "CONNECTED") {
                console.log("Could not establish the first three sessions.");
                return;
            }

            established.push(result.ws);

            // Keep all previously established streams open.
            await wait(250);
        }

        console.log(
            "\nThree sessions established. Opening connection 4..."
        );

        const fourth = await connectProbe(4);

        results.push(fourth);

        console.log({
            id: fourth.id,
            status: fourth.status,
            latencyMs: fourth.latencyMs,
            error: fourth.error || null,
            httpStatus: fourth.httpStatus || null,
        });

        console.log("\n========== T5 RESULTS ==========");

        console.table(
            results.map(({ ws, config, ...result }) => result)
        );

        console.log(
            "Maximum successfully established in this test:",
            results.filter(r => r.status === "CONNECTED").length
        );

    } finally {
        console.log("\nClosing test connections...");

        for (const ws of established) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        }

        await wait(500);
    }
}

main().catch((error) => {
    console.error("T5 FAILED:", error.message);
    process.exitCode = 1;
});
