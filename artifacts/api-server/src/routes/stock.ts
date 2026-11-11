import { Router, type IRouter, type Request, type Response } from "express";
import healthRouter from "./health";
import stockRouter from "./stock";
import storeSalesRouter from "./store-sales";
import reportRouter from "./report";

const router: IRouter = Router();

// ===========================================================================
// DAFTAR RUTE UTAMA API
// ===========================================================================
router.use(healthRouter);
router.use(stockRouter);
router.use(storeSalesRouter);
router.use(reportRouter);

// ===========================================================================
// GLOBAL 404 HANDLER (FALLBACK)
// ===========================================================================
// Jika frontend memanggil endpoint yang tidak terdaftar di atas, 
// API akan mengembalikan JSON 404 yang rapi, bukan halaman HTML error Express.
router.use((req: Request, res: Response) => {
  res.status(404).json({
    error: "Endpoint API tidak ditemukan.",
    path: req.originalUrl,
    method: req.method,
  });
});

export default router;