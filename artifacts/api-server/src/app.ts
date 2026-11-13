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
// Ini penyebab umum 429 misterius & login gagal di production.
app.set("trust proxy", 1);

// 1. Proteksi Header HTTP
app.use(helmet());

// 2. CORS HARUS dipasang SEBELUM rate limiter & body parser.
// FIX #1: daftar origin eksplisit, tidak pakai regex wildcard.
// FIX #3: agar error 429 tetap bawa header CORS (browser bisa baca).
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
      // origin undefined = Postman / server-to-server → izinkan
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // izinkan preview deployment Vercel milik project Anda saja
      if (/^https:\/\/kahfbrobandung[a-z0-9-]*\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} tidak diizinkan`));
    },
    credentials: true,
    // FIX #8: tambah PATCH (dipakai endpoint invoice)
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

// 3. Body parser — FIX #6: limit dinaikkan untuk import produk massal
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

// ==========================================
// TAMBAHAN BARU: Root Check (Agar 404 hilang)
// ==========================================
app.get("/", (req, res) => res.json({ status: "ok" }));

// 5. Health check — FIX #7: SEBELUM limiter & auth
// agar uptime monitor tidak kena rate limit / 401
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// 6. Rate Limiting — FIX #5: max dinaikkan ke 300 per 15 menit
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: "Terlalu banyak permintaan. Silakan coba lagi nanti." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

// 7. Satpam Auth & Router untuk aplikasi utama
app.use("/api", requireAuth, router);

// FIX #4a: 404 handler — selalu balas JSON agar frontend bisa parse
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Endpoint tidak ditemukan." });
});

// FIX #4b: Global error handler — cegah Express kirim HTML error page
// (yang akan membuat frontend React crash karena expect JSON)
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, url: req.url, method: req.method }, "Unhandled error");
  if (res.headersSent) return;
  const status = typeof err?.status === "number" ? err.status : 500;
  res.status(status).json({
    error: err?.message || "Terjadi kesalahan di server.",
  });
});

export default app;