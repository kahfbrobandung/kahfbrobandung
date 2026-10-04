import type { StockEntry } from "@workspace/db";

const SHEETS_FORM_URL =
  process.env.GOOGLE_SHEETS_FORM_URL ??
  "https://script.google.com/macros/s/AKfycbx993YnMgStwmOrelkMGSkbjAqPuVUXQFVoeatVZ8TPFvxHMoZK_P97eSjafnGpNGMZ/exec";

export async function syncStockEntryToSpreadsheet(entry: StockEntry) {
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
    throw new Error(`Spreadsheet returned HTTP ${response.status}.`);
  }

  await response.text();
}