import express from "express";
import cors from "cors";
import roomRoutes from "./routes/rooms.js";
const app = express();

app.use(cors({
    origin: "http://localhost:5173"
}));

app.use(express.json());
app.use("/api/rooms", roomRoutes);

app.get("/", (req, res) => {
    res.json({
        name: "Vāk",
        tagline: "Make different languages disappear.",
        message: "Welcome to Vāk API"
    });
});

app.get("/api/health", (req, res) => {
    res.status(200).json({
        status: "healthy",
        service: "vaak-backend"
    });
});

export default app;
