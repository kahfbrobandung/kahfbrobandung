import app from "./app";
import { logger } from "./lib/logger";
import { backfillLegacyStockLedger } from "./lib/stock-ledger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

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

void startServer().catch((err) => {
  logger.error({ err }, "Unable to initialize stock ledger");
  process.exit(1);
});
