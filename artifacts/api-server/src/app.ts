  import express, { type Express } from "express";
  import cors from "cors";
  import pinoHttp from "pino-http";
  import helmet from "helmet";
  import rateLimit from "express-rate-limit";
  import router from "./routes";
  import { logger } from "./lib/logger";
  import { requireAuth } from "./middlewares/auth";
  
  const app: Express = express();
  
  // 1. Proteksi Header HTTP
  app.use(helmet());
  
  // 2. Rate Limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    message: { error: "Terlalu banyak permintaan. Silakan coba lagi nanti." },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use("/api", limiter);
  
  // 3. Logger
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
  
  // 4. CORS
  app.use(cors({
    origin: ['https://www.kgebandung.online', 'https://kgebandung.online', /\.vercel\.app$/],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // 5. Health Check
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));
  
  // 6. Satpam Auth & Router untuk aplikasi utama
  app.use("/api", requireAuth, router);
  
  export default app;
