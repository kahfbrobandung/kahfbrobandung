import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireAuth } from "./middlewares/auth"; // <-- IMPORT SATPAM (Perhatikan pakai 's')

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Bagian CORS yang diperbarui agar mengizinkan domain Vercel
app.use(cors({
  origin: ['https://www.kgebandung.online', 'https://kgebandung.online', /\.vercel\.app$/],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// PENTING: Rute health check harus di ATAS satpam agar bisa dites tanpa login
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// Terapkan Satpam (requireAuth) sebelum masuk ke router utama
app.use("/api", requireAuth, router);

export default app;