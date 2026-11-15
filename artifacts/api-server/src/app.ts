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

// =========================================================================
// FIX #1: Trust proxy (WAJIB di Vercel — supaya req.ip = IP client asli)
// =========================================================================
app.set("trust proxy", 1);

// =========================================================================
// FIX #2: Helmet (proteksi header HTTP)
// =========================================================================
app.use(
  helmet({
    // Vercel + frontend cross-origin butuh ini
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// =========================================================================
// FIX #3: CORS — tetap seperti Anda, hanya tambah safety
// =========================================================================
const allowedOrigins = [
  "https://www.kgebandung.online",
  "https://kgebandung.online",
  "https://kahfbrobandung-bay.vercel.app",
  "http://localhost:5173",
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
  })
);

// =========================================================================
// FIX #4: Body parser
// =========================================================================
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// =========================================================================
// FIX #5: Logger — tambah `autoLogging.ignore` untuk health check
// =========================================================================
app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url === "/api/health",
    },
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
  })
);

// =========================================================================
// FIX #6: Root check
// =========================================================================
app.get("/", (_req, res) => res.json({ status: "ok" }));

// =========================================================================
// FIX #7: Health check — sekarang cek DB
// =========================================================================
app.get("/api/health", async (_req, res) => {
  try {
    // Sesuaikan dengan client DB Anda.
    // Kalau pakai Drizzle:
    //   import { db } from "@workspace/db";
    //   import { sql } from "drizzle-orm";
    //   await db.execute(sql`SELECT 1`);
    //
    // Kalau pakai Supabase:
    //   const { error } = await supabaseAdmin.from("_health").select("id").limit(1);
    //   if (error) throw error;

    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "health check db failed");
    res.status(503).json({ status: "degraded" });
  }
});

// =========================================================================
// FIX #8: Rate limiter dibagi 2 tier
//   - /api/auth/*  → 50 req / 15 menit  (lindungi brute-force login)
//   - /api/* lain  → 1000 req / 15 menit (user aktif tidak ke-block)
// =========================================================================
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Terlalu banyak percobaan login. Coba lagi nanti." },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: "Terlalu banyak permintaan. Silakan coba lagi nanti." },
  standardHeaders: true,
  legacyHeaders: false,
});

// =========================================================================
// FIX #9: AKTIFKAN requireAuth SECARA SELEKTIF
//   Route publik di bawah ini tidak butuh token. Selain itu WAJIB login.
//   ⚠️ Sesuaikan list ini dengan path asli di routes/index.ts Anda.
// =========================================================================
const publicApiPaths = [
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  // "/auth/logout", // buka komentar kalau logout boleh tanpa token
];

function selectiveAuth(req: Request, res: Response, next: NextFunction) {
  const path = req.path; // relatif terhadap mount /api
  for (const p of publicApiPaths) {
    if (path === p || path.startsWith(p + "/")) return next();
  }
  return requireAuth(req, res, next);
}

// Rate limit KETAT khusus auth
app.use("/api/auth", publicLimiter);

// Rate limit normal + auth selektif + router utama
app.use("/api", apiLimiter, selectiveAuth, router);

// =========================================================================
// FIX #10: 404 handler untuk /api
// =========================================================================
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Endpoint tidak ditemukan." });
});

// =========================================================================
// FIX #11: Global error handler (4 argumen — jangan diubah signature-nya)
// =========================================================================
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const status = typeof err?.status === "number" ? err.status : 500;
  const isProd = process.env.NODE_ENV === "production";

  logger.error(
    { err, url: req.url, method: req.method, status },
    "Unhandled error"
  );

  if (res.headersSent) return;

  res.status(status).json({
    // Jangan bocorkan pesan internal di production untuk 5xx
    error:
      status >= 500 && isProd
        ? "Terjadi kesalahan di server."
        : err?.message || "Terjadi kesalahan di server.",
  });
});

export default app;