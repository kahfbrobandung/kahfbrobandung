import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireAuth } from "./middlewares/auth";

const app: Express = express();

// FIX #2: WAJIB untuk Vercel. Tanpa ini, req.ip = IP proxy Vercel,
// sehingga rate limit menganggap SEMUA user sebagai satu IP.
app.set("trust proxy", 1);

// 1. Proteksi Header HTTP
app.use(helmet());

// 2. CORS HARUS dipasang SEBELUM rate limiter & body parser.
const allowedOrigins = [
  "https://www.kgebandung.online",
  "https://kgebandung.online",
  "https://kahfbrobandung-bay.vercel.app", // frontend aktif
  "http://localhost:5173", // dev lokal Vite
  "http://localhost:3000",
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (/^https:\/\/kahfbrobandung[a-z0-9-]*\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} tidak diizinkan`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

// 3. Body parser
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// 4. Logger
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

// 5. Root Check
app.get("/", (req, res) => res.json({ status: "ok" }));

// 6. Health check
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// 7. Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: "Terlalu banyak permintaan. Silakan coba lagi nanti." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

// =========================================================================
// ⚠️ SEMENTARA DIMATIKAN UNTUK TES:
// Kita hapus requireAuth agar bisa dites langsung dari browser.
// =========================================================================
app.use("/api", router); 
// app.use("/api", requireAuth, router); // <--- Nanti ini diaktifkan lagi

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Endpoint tidak ditemukan." });
});

// Global error handler
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, url: req.url, method: req.method }, "Unhandled error");
  if (res.headersSent) return;
  const status = typeof err?.status === "number" ? err.status : 500;
  res.status(status).json({
    error: err?.message || "Terjadi kesalahan di server.",
  });
});

export default app;