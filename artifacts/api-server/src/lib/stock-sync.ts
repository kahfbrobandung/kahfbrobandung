import type { StockEntry } from "@workspace/db";
import { logger } from "./logger"; // ✅ FIX: path sudah benar

const SHEETS_FORM_URL = process.env.GOOGLE_SHEETS_FORM_URL;

export async function syncStockEntryToSpreadsheet(entry: StockEntry): Promise<void> {
  if (!SHEETS_FORM_URL) {
    return;
  }

  try {
    const response = await fetch(SHEETS_FORM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        store: entry.store,
        transaction: entry.transaction,
        product: entry.product,
        quantity: entry.quantity,
        barcode: entry.barcode,
        displayQuantity: entry.displayQuantity,
        secondaryDisplayQuantity: entry.secondaryDisplayQuantity,
        warehouseQuantity: entry.warehouseQuantity,
      }),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Google Sheets sync gagal (HTTP error)"
      );
    }
  } catch (err: any) { // ✅ FIX: tambahkan tipe `any`
    logger.error(
      { err: err.message || err, product: entry.product },
      "Error jaringan saat sinkronisasi ke Google Sheets"
    );
  }
}