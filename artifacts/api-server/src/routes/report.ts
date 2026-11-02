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
  const fromParam = typeof req.query.from === "string" ? req.query.from.trim() : "";
  const toParam = typeof req.query.to === "string" ? req.query.to.trim() : "";
  if (!fromParam || !toParam) {
    res.status(400).json({ error: "Tanggal mulai dan akhir wajib diisi dengan format YYYY-MM-DD." });
    return;
  }

  const parsed = GetSalesActivityQueryParams.safeParse({
    ...req.query,
    from: new Date(fromParam),
    to: new Date(toParam),
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Parameter riwayat aktivitas tidak valid." });
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
  const normalizedRequestedStore = requestedStore ? normalizeStoreName(requestedStore) : undefined;
  const limit = parsed.data.limit;
  const occurredAt = sql`COALESCE(${stockEntriesTable.occurredAt}, ${stockEntriesTable.createdAt})`;
  const activityConditions = [
    gte(occurredAt, from),
    lt(occurredAt, toExclusive),
    ...(normalizedRequestedStore
      ? [sql`lower(regexp_replace(trim(${stockEntriesTable.store}), '[[:space:]]+', ' ', 'g')) = ${normalizedRequestedStore}`]
      : []),
  ];
  const ledgerEntries = await db
    .select()
    .from(stockEntriesTable)
    .where(and(...activityConditions))
    .orderBy(desc(occurredAt), desc(stockEntriesTable.createdAt), desc(stockEntriesTable.id))
    .limit(limit);
  const activity = ledgerEntries.map((entry) => {
    const isVisitCorrection = entry.sourceType === "visit_correction";
    const isRestock = entry.sourceType === "restock";
    const isInvoiceCorrection = entry.sourceType === "restock_invoice";
    const quantity = entry.sourceType === "manual" && entry.transaction.trim().toLocaleLowerCase("id-ID") === "penjualan"
      ? -entry.quantity
      : entry.quantity;
    const signedQuantity = quantity > 0 ? `+${quantity}` : String(quantity);
    const recordType = isVisitCorrection
      ? "stock_visit" as const
      : isRestock || isInvoiceCorrection
        ? "stock_restock" as const
        : "stock_entry" as const;
    const title = isVisitCorrection
      ? "Koreksi fisik (kunjungan)"
      : isRestock
        ? "Barang masuk"
        : isInvoiceCorrection
          ? "Koreksi faktur"
          : `Input stok · ${entry.transaction}`;
    const description = isVisitCorrection
      ? `${entry.product} · hitungan fisik ${entry.countedQuantity ?? 0} unit · koreksi ${signedQuantity} unit`
      : isRestock
        ? `${entry.product} · ${entry.barcode} · +${entry.quantity} unit diterima`
        : isInvoiceCorrection
          ? `${entry.product} · penyesuaian faktur ${signedQuantity} unit`
          : `${entry.product || "Produk"} · ${entry.barcode} · ${signedQuantity} unit`;

    return {
      id: entry.id,
      recordType,
      store: displayStoreName(entry.store),
      occurredAt: iso(entry.occurredAt ?? entry.createdAt),
      title,
      description,
      quantity,
      skuCount: isVisitCorrection ? 1 : null,
      syncStatus: entry.sourceType === "manual" ? entry.syncStatus : null,
    };
  });

  res.json(GetSalesActivityResponse.parse(activity));
});

router.get("/sales-monitor", async (req, res) => {
  const fromParam = typeof req.query.from === "string" ? req.query.from.trim() : "";
  const toParam = typeof req.query.to === "string" ? req.query.to.trim() : "";
  if (!fromParam || !toParam) {
    res.status(400).json({ error: "Tanggal mulai dan akhir wajib diisi dengan format YYYY-MM-DD." });
    return;
  }

  const parsed = GetSalesMonitorQueryParams.safeParse({
    ...req.query,
    from: new Date(fromParam),
    to: new Date(toParam),
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Tanggal mulai dan akhir wajib diisi dengan format tanggal yang valid." });
    return;
  }

  const from = jakartaStartOfDay(fromParam);
  const toExclusive = jakartaStartOfDay(toParam);
  if (!from || !toExclusive) {
    res.status(400).json({ error: "Gunakan tanggal yang valid dengan format YYYY-MM-DD." });
    return;
  }
  if (from > toExclusive) {
    res.status(400).json({ error: "Tanggal mulai tidak boleh setelah tanggal akhir." });
    return;
  }
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  const requestedStoreKey = parsed.data.store?.trim()
    ? normalizeStoreKey(parsed.data.store)
    : undefined;
  const storeFilter = requestedStoreKey
    ? sql`AND lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) = ${requestedStoreKey}`
    : sql``;
    
  const result = await db.execute<SalesQueryRow>(sql`
    WITH numbered_visits AS (
      SELECT
        e.store,
        lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) AS store_key,
        e.id AS visit_id,
        e.occurred_at AS "currentVisitAt",
        e.created_at AS "currentVisitCreatedAt",
        e.product,
        e.barcode,
        e.counted_quantity AS "currentStock",
        LAG(e.id) OVER (
          PARTITION BY lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')), e.barcode
          ORDER BY e.occurred_at, e.created_at, e.id
        ) AS "previousVisitId",
        LAG(e.occurred_at) OVER (
          PARTITION BY lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')), e.barcode
          ORDER BY e.occurred_at, e.created_at, e.id
        ) AS "previousVisitAt",
        LAG(e.created_at) OVER (
          PARTITION BY lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')), e.barcode
          ORDER BY e.occurred_at, e.created_at, e.id
        ) AS "previousVisitCreatedAt",
        LAG(e.counted_quantity) OVER (
          PARTITION BY lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')), e.barcode
          ORDER BY e.occurred_at, e.created_at, e.id
        ) AS "previousStock"
      FROM stock_entries e
      WHERE e.source_type = 'visit_correction'
        AND e.counted_quantity IS NOT NULL
        AND e.occurred_at < ${toExclusive}
      ${storeFilter}
    ),
    intervals AS (
      SELECT
        n.*,
        COALESCE((
          SELECT SUM(e.quantity)
          FROM stock_entries e
          WHERE e.source_type IN ('restock', 'restock_invoice')
            AND lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) = n.store_key
            AND e.barcode = n.barcode
            AND (
              n."previousVisitAt" IS NULL OR
              (
                COALESCE(e.occurred_at, e.created_at),
                e.created_at,
                e.id
              ) > (
                n."previousVisitAt",
                n."previousVisitCreatedAt",
                n."previousVisitId"
              )
            )
            AND (
              COALESCE(e.occurred_at, e.created_at),
              e.created_at,
              e.id
            ) <= (
              n."currentVisitAt",
              n."currentVisitCreatedAt",
              n.visit_id
            )
        ), 0) AS "restockQuantity"
        ,COALESCE((
          SELECT SUM(
            CASE
              WHEN lower(trim(e.transaction)) = 'penjualan' THEN -e.quantity
              ELSE e.quantity
            END
          )
          FROM stock_entries e
          WHERE lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g'))
              = n.store_key
            AND e.barcode = n.barcode
            AND (
              e.source_type NOT IN ('visit_correction', 'restock', 'restock_invoice')
              OR e.source_type IS NULL
            )
            AND (
              n."previousVisitAt" IS NULL OR
              (
                COALESCE(e.occurred_at, e.created_at),
                e.created_at,
                e.id
              ) > (
                n."previousVisitAt",
                n."previousVisitCreatedAt",
                n."previousVisitId"
              )
            )
            AND (
              COALESCE(e.occurred_at, e.created_at),
              e.created_at,
              e.id
            ) <= (
              n."currentVisitAt",
              n."currentVisitCreatedAt",
              n.visit_id
            )
        ), 0) AS "stockEntryAdjustment"
      FROM numbered_visits n
      WHERE n."currentVisitAt" >= ${from}
    )
    SELECT
      store,
      product,
      barcode,
      "previousVisitAt",
      "currentVisitAt",
      COALESCE("previousStock", 0)::int AS "previousStock",
      "restockQuantity"::int AS "restockQuantity",
      "stockEntryAdjustment"::int AS "stockEntryAdjustment",
      "currentStock"::int AS "currentStock",
      (COALESCE("previousStock", 0) + "restockQuantity" + "stockEntryAdjustment" - "currentStock")::int AS "soldQuantity",
      (COALESCE("previousStock", 0) + "restockQuantity" + "stockEntryAdjustment" - "currentStock") < 0 AS "hasStockVariance"
    FROM intervals
    ORDER BY "currentVisitAt" DESC, store, product
  `);

  const calculations = result.rows.map((row) => ({
    store: row.store,
    product: row.product,
    barcode: row.barcode,
    previousVisitAt: row.previousVisitAt ? iso(row.previousVisitAt) : null,
    currentVisitAt: iso(row.currentVisitAt),
    previousStock: Number(row.previousStock),
    restockQuantity: Number(row.restockQuantity),
    stockEntryAdjustment: Number(row.stockEntryAdjustment),
    currentStock: Number(row.currentStock),
    soldQuantity: Number(row.soldQuantity),
    hasStockVariance: row.hasStockVariance,
  }));

  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const trendMap = new Map<string, { soldQuantity: number; restockQuantity: number }>();
  const productMap = new Map<
    string,
    {
      store: string;
      product: string;
      barcode: string;
      totalSold: number;
      totalRestocked: number;
      latestStock: number;
      visitComparisons: number;
      varianceCount: number;
      lastVisitAt: string;
      lastVisitMs: number;
    }
  >();
  const storeMap = new Map<
    string,
    { store: string; totalSold: number; totalRestocked: number; skuCount: number; varianceCount: number }
  >();

  for (const calculation of calculations) {
    const sale = Math.max(0, calculation.soldQuantity);
    const date = dateFormatter.format(new Date(calculation.currentVisitAt));
    const trend = trendMap.get(date) ?? { soldQuantity: 0, restockQuantity: 0 };
    trend.soldQuantity += sale;
    trend.restockQuantity += calculation.restockQuantity;
    trendMap.set(date, trend);

    const productKey = `${calculation.store}\u0000${calculation.barcode}`;
    const latestAt = new Date(calculation.currentVisitAt).getTime();
    const product = productMap.get(productKey) ?? {
      store: calculation.store,
      product: calculation.product,
      barcode: calculation.barcode,
      totalSold: 0,
      totalRestocked: 0,
      latestStock: calculation.currentStock,
      visitComparisons: 0,
      varianceCount: 0,
      lastVisitAt: calculation.currentVisitAt,
      lastVisitMs: -Infinity,
    };
    product.totalSold += sale;
    product.totalRestocked += calculation.restockQuantity;
    product.visitComparisons += 1;
    product.varianceCount += calculation.hasStockVariance ? 1 : 0;
    if (latestAt >= product.lastVisitMs) {
      product.latestStock = calculation.currentStock;
      product.lastVisitAt = calculation.currentVisitAt;
      product.lastVisitMs = latestAt;
      product.product = calculation.product;
    }
    productMap.set(productKey, product);

    const store = storeMap.get(calculation.store) ?? {
      store: calculation.store,
      totalSold: 0,
      totalRestocked: 0,
      skuCount: 0,
      varianceCount: 0,
    };
    store.totalSold += sale;
    store.totalRestocked += calculation.restockQuantity;
    store.varianceCount += calculation.hasStockVariance ? 1 : 0;
    storeMap.set(calculation.store, store);
  }

  for (const product of productMap.values()) {
    const store = storeMap.get(product.store);
    if (store) store.skuCount += 1;
  }

  const products = [...productMap.values()]
    .map(({ lastVisitMs: _lastVisitMs, ...product }) => product)
    .sort((a, b) => b.totalSold - a.totalSold || a.product.localeCompare(b.product));
  const stores = [...storeMap.values()].sort(
    (a, b) => b.totalSold - a.totalSold || a.store.localeCompare(b.store),
  );
  const dailyTrend = [...trendMap.entries()]
    .map(([date, values]) => ({ date, ...values }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.json({
    summary: {
      totalSold: calculations.reduce((total, item) => total + Math.max(0, item.soldQuantity), 0),
      totalRestocked: calculations.reduce((total, item) => total + item.restockQuantity, 0),
      activeStores: stores.length,
      trackedSkus: products.length,
      visitComparisons: calculations.length,
      varianceCount: calculations.filter((item) => item.hasStockVariance).length,
    },
    dailyTrend,
    stores,
    products,
    calculations,
  });
});

export default router;
