import app from "./app";
import { logger } from "./lib/logger";
import { backfillLegacyStockLedger } from "./lib/stock-ledger";

// 1. Ekspor app untuk Vercel Serverless Handler
export default app;

const port = Number(process.env["PORT"] || 3000);
const isVercel = process.env.VERCEL === "1";

// 2. Fungsi inisialisasi yang aman (dibungkus try-catch)
async function initializeDatabase() {
  try {
    const backfill = await backfillLegacyStockLedger();
    if (backfill.entriesAdded > 0) {
      logger.info(backfill, "Legacy stock movements copied into the shared ledger");
    }
  } catch (err) {
    logger.error({ err }, "Gagal menjalankan backfill stock ledger");
  }
}

if (!isVercel) {
  // === LINGKUNGAN LOKAL (DEV) ===
  async function startLocalServer() {
    // Tunggu backfill selesai sebelum server lokal menyala
    await initializeDatabase(); 
    
    app.listen(port, () => {
      logger.info({ port }, "Server listening locally");
    });
  }

  void startLocalServer().catch((err) => {
    logger.error({ err }, "Unable to initialize local server");
    process.exit(1);
  });
} else {
  // === LINGKUNGAN VERCEL (SERVERLESS) ===
  // Jalankan backfill di background (fire-and-forget) 
  // agar tidak menahan (timeout) saat request pertama masuk.
  void initializeDatabase();
}