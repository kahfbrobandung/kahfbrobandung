import type { StockEntry } from "@workspace/db";
import { logger } from "../lib/logger"; // Pastikan path logger ini sesuai dengan project Anda

// Ambil URL dari environment variable. 
// Hapus URL hardcoded demi keamanan (agar tidak disalahgunakan orang lain).
const SHEETS_FORM_URL = process.env.GOOGLE_SHEETS_FORM_URL;

/**
 * Fungsi untuk sinkronisasi ke Google Sheets.
 * 
 * PENTING: Fungsi ini dirancang sebagai "Fire-and-Forget".
 * JANGAN gunakan `await` saat memanggil fungsi ini di routes Anda.
 * Cukup panggil `void syncStockEntryToSpreadsheet(entry);`
 * agar server tidak menunggu (mencegah Vercel Timeout).
 */
export async function syncStockEntryToSpreadsheet(entry: StockEntry): Promise<void> {
  // 1. Jika URL belum diatur di Vercel, langsung lewati tanpa error
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
      // Jika Google Sheets error (misal script mati), catat di log tapi jangan crash
      logger.warn(
        { status: response.status }, 
        "Google Sheets sync gagal (HTTP error)"
      );
    }
  } catch (err) {
    // Tangkap error jaringan agar aplikasi utama tidak ikut crash
    logger.error(
      { err, product: entry.product }, 
      "Error jaringan saat sinkronisasi ke Google Sheets"
    );
  }
}