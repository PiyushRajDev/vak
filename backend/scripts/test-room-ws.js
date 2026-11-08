
import WebSocket from "ws";

const API = "http://localhost:8000";

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

        for (let i = waiters.length - 1; i >= 0; i--) {
            const waiter = waiters[i];

            if (
                waiter.type === event.type &&
                waiter.predicate(event)
            ) {
                clearTimeout(waiter.timer);
                waiters.splice(i, 1);
                waiter.resolve(event);
            }
        }

        console.log(`[${event.type}]`);
    });

    function waitFor(
        type,
        predicate = () => true,
        timeoutMs = 7000
    ) {
        const existing = events.find(
            event => event.type === type && predicate(event)
        );

        if (existing) return Promise.resolve(existing);

        return new Promise((resolve, reject) => {
            const waiter = {
                type,
                predicate,
                resolve,
                timer: null,
            };

            waiter.timer = setTimeout(() => {
                const index = waiters.indexOf(waiter);

                if (index !== -1) {
                    waiters.splice(index, 1);
                }

                reject(new Error(`Timed out waiting for ${type}`));
            }, timeoutMs);

            waiters.push(waiter);
        });
    }

    const opened = new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
    });

    return {
        ws,
        opened,
        waitFor,
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

    console.log(
        `${result.self.displayName} authenticated successfully`
    );

    return client;
}

async function main() {
    let hostClient;
    let guestClient;

    try {
        console.log("\n1. Creating a temporary room...");

        const host = await apiRequest("/api/rooms", {
            method: "POST",
            body: JSON.stringify({
                displayName: "Test Host",
                spokenLanguage: "hi-IN",
                preferredLanguage: "ta-IN",
            }),
        });

        const roomCode = host.room.roomCode;

        console.log("Room created:", roomCode);

        console.log("\n2. Adding the second participant...");

        const guest = await apiRequest(
            `/api/rooms/${roomCode}/join`,
            {
                method: "POST",
                body: JSON.stringify({
                    displayName: "Test Guest",
                    spokenLanguage: "ta-IN",
                    preferredLanguage: "hi-IN",
                }),
            }
        );

        console.log("Second participant joined");

        console.log("\n3. Authenticating both WebSockets...");

        hostClient = await connectParticipant(roomCode, host);
        guestClient = await connectParticipant(roomCode, guest);

        const twoConnected = await hostClient.waitFor(
            "room_updated",
            event => event.room.participants.length === 2 &&
                event.room.participants.every(p => p.connected)
        );

        console.log(
            "Connected participants:",
            twoConnected.room.participants.length
        );

        console.log("\n4. Testing mute synchronization...");

        const muteUpdate = hostClient.waitFor(
            "room_updated",
            event => event.room.participants.some(
                p => p.id === guest.self.id && p.isMuted
            )
        );

        guestClient.ws.send(JSON.stringify({
            type: "set_mute",
            isMuted: true,
        }));

        await muteUpdate;

        console.log("Mute update reached the host");

        console.log("\n5. Testing unmute...");

        const unmuteUpdate = hostClient.waitFor(
            "room_updated",
            event => event.room.participants.some(
                p => p.id === guest.self.id && !p.isMuted
            )
        );

        guestClient.ws.send(JSON.stringify({
            type: "set_mute",
            isMuted: false,
        }));

        await unmuteUpdate;

        console.log("Unmute update reached the host");

        console.log("\n6. Testing participant departure...");

        const guestLeft = guestClient.waitFor("left_room");

        const oneParticipant = hostClient.waitFor(
            "room_updated",
            event => event.room.participants.length === 1
        );

        guestClient.ws.send(JSON.stringify({
            type: "leave",
        }));

        await Promise.all([guestLeft, oneParticipant]);

        console.log("Guest left; host received updated room state");

        console.log("\n7. Cleaning up the temporary room...");

        const hostLeft = hostClient.waitFor("left_room");

        hostClient.ws.send(JSON.stringify({
            type: "leave",
        }));

        await hostLeft;

        console.log("\n========== M8.1 PASSED ==========");
        console.log("Authentication: passed");
        console.log("Presence broadcast: passed");
        console.log("Mute synchronization: passed");
        console.log("Unmute synchronization: passed");
        console.log("Participant departure: passed");

    } finally {
        for (const client of [guestClient, hostClient]) {
            if (
                client?.ws.readyState === WebSocket.OPEN
            ) {
                client.ws.close();
            }
        }
    }
}

main().catch(error => {
    console.error("\nM8.1 TEST FAILED:", error.message);
    process.exitCode = 1;
});
