import { Router, type IRouter, type Request, type Response } from "express";
import healthRouter from "./health";
import stockRouter from "./stock";
import storeSalesRouter from "./store-sales";
import reportRouter from "./report";

const router: IRouter = Router();

// ===========================================================================
// DAFTAR RUTE UTAMA API
// Urutan tidak mempengaruhi path matching; dikelompokkan agar mudah dibaca.
// ===========================================================================
router.use(healthRouter);      // GET  /api/healthz
router.use(stockRouter);       // /api/stock-entries, /api/stock-balances, ...
router.use(storeSalesRouter);  // /api/stock-visits, /api/stock-restocks, /api/stores (POST)
router.use(reportRouter);      // /api/stores (GET), /api/daily-sales, /api/sales-*

// ===========================================================================
// GLOBAL 404 HANDLER (FALLBACK)
// Selalu balas JSON agar frontend (dan monitoring) bisa parse dengan aman.
// ===========================================================================
router.use((req: Request, res: Response) => {
  res.status(404).json({
    error: "Endpoint API tidak ditemukan.",
    path: req.originalUrl,
    method: req.method,
  });
});

export default router;