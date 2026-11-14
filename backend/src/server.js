
import "dotenv/config";
import { createServer } from "node:http";
import { attachRoomSocket } from "./services/rooms/room-socket.js";
import app from "./app.js";
import { attachPrismaProxy } from "./services/stt/prisma-proxy.js";

const PORT = process.env.PORT || 8000;

const server = createServer(app);

attachPrismaProxy(server);
attachRoomSocket(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Vāk backend running on http://0.0.0.0:${PORT}`);
});
