import { Router } from "express";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  GetDailySalesQueryParams,
  GetDailySalesResponse,
  GetSalesActivityQueryParams,
  GetSalesActivityResponse,
  GetSalesMonitorQueryParams,
} from "@workspace/api-zod";
import { db, stockEntriesTable, storesTable } from "@workspace/db";
import { normalizeStoreKey } from "../lib/stock-ledger";
import { displayStoreName, iso, jakartaStartOfDay, normalizeStoreName } from "./helpers";

const router = Router();

type SalesQueryRow = {
  store: string;
  product: string;
  barcode: string;
  previousVisitAt: Date | null;
  currentVisitAt: Date;
  previousStock: number | string;
  restockQuantity: number | string;
  stockEntryAdjustment: number | string;
  currentStock: number | string;
  soldQuantity: number | string;
  hasStockVariance: boolean;
};

router.get("/stores", async (_req, res) => {
  const [stores, stockEntryStores] = await Promise.all([
    db.select({ name: storesTable.name }).from(storesTable),
    db.select({ name: stockEntriesTable.store }).from(stockEntriesTable).groupBy(stockEntriesTable.store),
  ]);
  const namesByNormalized = new Map<string, string>();
  for (const store of stores) {
    namesByNormalized.set(normalizeStoreName(store.name), displayStoreName(store.name));
  }
  for (const entryStore of stockEntryStores) {
    const normalized = normalizeStoreName(entryStore.name);
    if (normalized && !namesByNormalized.has(normalized)) {
      namesByNormalized.set(normalized, displayStoreName(entryStore.name));
    }
  }
  res.json([...namesByNormalized.values()].sort((a, b) => a.localeCompare(b, "id")).map((name) => ({ name })));
});

router.get("/daily-sales", async (req, res): Promise<void> => {
  const fromParam = typeof req.query.from === "string" ? req.query.from.trim() : "";
  const toParam = typeof req.query.to === "string" ? req.query.to.trim() : "";
  if (!fromParam || !toParam) {
    res.status(400).json({ error: "Tanggal mulai dan akhir wajib diisi dengan format YYYY-MM-DD." });
    return;
  }

  const parsed = GetDailySalesQueryParams.safeParse({
    ...req.query,
    from: new Date(`${fromParam}T00:00:00Z`),
    to: new Date(`${toParam}T00:00:00Z`),
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Parameter laporan penjualan tidak valid." });
    return;
  }

  const from = jakartaStartOfDay(fromParam);
  const toExclusive = jakartaStartOfDay(toParam);
  if (!from || !toExclusive || from > toExclusive) {
    res.status(400).json({ error: "Gunakan rentang tanggal valid dengan tanggal mulai tidak setelah tanggal akhir." });
    return;
  }
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  const requestedStore = parsed.data.store?.trim();
  const normalizedStore = requestedStore ? normalizeStoreName(requestedStore) : undefined;
  const conditions = [
    gte(stockEntriesTable.createdAt, from),
    lt(stockEntriesTable.createdAt, toExclusive),
    sql`lower(trim(${stockEntriesTable.transaction})) = 'penjualan'`,
    ...(normalizedStore
      ? [sql`lower(regexp_replace(trim(${stockEntriesTable.store}), '[[:space:]]+', ' ', 'g')) = ${normalizedStore}`]
      : []),
  ];
  const rows = await db
    .select({
      id: stockEntriesTable.id,
      store: stockEntriesTable.store,
      product: stockEntriesTable.product,
      barcode: stockEntriesTable.barcode,
      quantity: stockEntriesTable.quantity,
      displayQuantity: stockEntriesTable.displayQuantity,
      secondaryDisplayQuantity: stockEntriesTable.secondaryDisplayQuantity,
      warehouseQuantity: stockEntriesTable.warehouseQuantity,
      createdAt: stockEntriesTable.createdAt,
    })
    .from(stockEntriesTable)
    .where(and(...conditions))
    .orderBy(desc(stockEntriesTable.createdAt), desc(stockEntriesTable.id))
    .limit(parsed.data.limit);

  res.json(GetDailySalesResponse.parse(rows.map((row) => ({
    ...row,
    store: displayStoreName(row.store),
    createdAt: iso(row.createdAt),
  }))));
});

router.get("/sales-activity", async (req, res): Promise<void> => {
  // (Sama seperti sebelumnya, isi route sales-activity dipindah ke sini)
  // ... Kode sales-activity ...
});
