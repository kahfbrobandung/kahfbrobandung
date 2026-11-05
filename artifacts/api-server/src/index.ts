import app from "./app";
import { logger } from "./lib/logger";
import { backfillLegacyStockLedger } from "./lib/stock-ledger";

// Ekspor app untuk Vercel Serverless
export default app;

const port = Number(process.env["PORT"] || 3000);

async function startServer() {
  const backfill = await backfillLegacyStockLedger();
  if (backfill.entriesAdded > 0) {
    logger.info(backfill, "Legacy stock movements copied into the shared ledger");
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

// Hanya jalankan server jika di lokal (bukan di Vercel)
if (process.env.VERCEL !== "1") {
  void startServer().catch((err) => {
    logger.error({ err }, "Unable to initialize stock ledger");
    process.exit(1);
  });
}
