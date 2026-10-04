import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateStockEntryBody,
  DeleteStockEntryParams,
  DeleteStockEntryResponse,
  ListStockBalancesQueryParams,
  ListStockEntriesQueryParams,
  RetryStockEntrySyncParams,
} from "@workspace/api-zod";
import { db, stockEntriesTable, type StockEntry } from "@workspace/db";
import { logger } from "../lib/logger";
import { syncStockEntryToSpreadsheet } from "../lib/stock-sync";

const router: IRouter = Router();

function responseData(entry: StockEntry) {
  return {
    ...entry,
    createdAt: entry.createdAt.toISOString(),
    syncedAt: entry.syncedAt?.toISOString() ?? null,
  };
}

async function updateSyncStatus(entry: StockEntry) {
  try {
    await syncStockEntryToSpreadsheet(entry);
    const [updated] = await db
      .update(stockEntriesTable)
      .set({
        syncStatus: "synced",
        syncError: null,
        syncedAt: new Date(),
      })
      .where(eq(stockEntriesTable.id, entry.id))
      .returning();
    return updated ?? entry;
  } catch (error) {
    const syncError = error instanceof Error ? error.message : "Unknown spreadsheet error.";
    logger.warn({ entryId: entry.id, err: error }, "Spreadsheet synchronization failed");
    const [updated] = await db
      .update(stockEntriesTable)
      .set({
        syncStatus: "failed",
        syncError,
      })
      .where(eq(stockEntriesTable.id, entry.id))
      .returning();
    return updated ?? entry;
  }
}

router.get("/stock-entries", async (req, res) => {
  const requestedStore = typeof req.query.store === "string" ? req.query.store.trim() : "";
  if (!requestedStore) {
    res.status(400).json({ error: "Nama toko wajib diisi untuk melihat data stok." });
    return;
  }

  const parsed = ListStockEntriesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Parameter filter tidak valid." });
    return;
  }

  const conditions = [eq(stockEntriesTable.store, requestedStore)];
  const entries = await db
    .select()
    .from(stockEntriesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(stockEntriesTable.createdAt))
    .limit(parsed.data.limit ?? 25);

  res.json(entries.map(responseData));
});

router.delete("/stock-entries/:id", async (req, res): Promise<void> => {
  const parsed = DeleteStockEntryParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "ID transaksi stok tidak valid." });
    return;
  }

  const [deleted] = await db
    .delete(stockEntriesTable)
    .where(eq(stockEntriesTable.id, parsed.data.id))
    .returning({ id: stockEntriesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Transaksi stok tidak ditemukan." });
    return;
  }

  res.json(DeleteStockEntryResponse.parse({
    id: deleted.id,
    spreadsheetMirrorMayRemain: true,
  }));
});

router.get("/stock-balances", async (req, res) => {
  const requestedStore = typeof req.query.store === "string" ? req.query.store.trim() : "";
  if (!requestedStore) {
    res.status(400).json({ error: "Nama toko wajib diisi untuk melihat saldo SKU." });
    return;
  }

  const parsed = ListStockBalancesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Parameter filter saldo tidak valid." });
    return;
  }

  const storeKey = requestedStore.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
  type UnifiedBalanceRow = {
    store: string;
    product: string;
    barcode: string;
    totalQuantity: number | string;
    displayQuantity: number | string;
    secondaryDisplayQuantity: number | string;
    warehouseQuantity: number | string;
    entryCount: number | string;
    updatedAt: Date | string;
  };
  const result = await db.execute<UnifiedBalanceRow>(sql`
    WITH all_keys AS (
      SELECT
        lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) AS store_key,
        e.store AS store,
        e.product,
        e.barcode,
        e.created_at AS occurred_at
      FROM stock_entries e
      WHERE lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) = ${storeKey}
      UNION ALL
      SELECT s.normalized_name, s.name, l.product, l.barcode, v.visited_at
      FROM stock_visits v
      INNER JOIN stores s ON s.id = v.store_id
      INNER JOIN stocktake_lines l ON l.visit_id = v.id
      WHERE s.normalized_name = ${storeKey}
      UNION ALL
      SELECT s.normalized_name, s.name, r.product, r.barcode, r.received_at
      FROM stock_restocks r
      INNER JOIN stores s ON s.id = r.store_id
      WHERE s.normalized_name = ${storeKey}
    ),
    key_rows AS (
      SELECT DISTINCT ON (store_key, barcode)
        store_key,
        store,
        product,
        barcode
      FROM all_keys
      ORDER BY store_key, barcode, occurred_at DESC, product ASC
    ),
    latest_visits AS (
      SELECT DISTINCT ON (s.normalized_name, l.barcode)
        s.normalized_name AS store_key,
        s.name AS store,
        l.product,
        l.barcode,
        v.id AS visit_id,
        v.visited_at,
        v.created_at AS visit_created_at,
        l.total_quantity,
        l.display_quantity,
        l.secondary_display_quantity,
        l.warehouse_quantity
      FROM stock_visits v
      INNER JOIN stores s ON s.id = v.store_id
      INNER JOIN stocktake_lines l ON l.visit_id = v.id
      WHERE s.normalized_name = ${storeKey}
      ORDER BY s.normalized_name, l.barcode, v.visited_at DESC, v.id DESC
    ),
    entry_totals AS (
      SELECT
        lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) AS store_key,
        e.barcode,
        SUM(CASE WHEN lower(trim(e.transaction)) = 'penjualan' THEN -e.quantity ELSE e.quantity END) AS all_quantity,
        SUM(
          CASE
            WHEN lv.visit_id IS NULL OR e.created_at > lv.visited_at
              THEN CASE WHEN lower(trim(e.transaction)) = 'penjualan' THEN -e.quantity ELSE e.quantity END
            ELSE 0
          END
        ) AS since_visit_quantity,
        SUM(CASE WHEN lv.visit_id IS NULL OR e.created_at > lv.visited_at THEN e.display_quantity ELSE 0 END) AS display_quantity,
        SUM(CASE WHEN lv.visit_id IS NULL OR e.created_at > lv.visited_at THEN e.secondary_display_quantity ELSE 0 END) AS secondary_display_quantity,
        SUM(CASE WHEN lv.visit_id IS NULL OR e.created_at > lv.visited_at THEN e.warehouse_quantity ELSE 0 END) AS warehouse_quantity,
        COUNT(*) AS entry_count,
        MAX(e.created_at) AS updated_at
      FROM stock_entries e
      LEFT JOIN latest_visits lv
        ON lv.store_key = lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g'))
        AND lv.barcode = e.barcode
      WHERE lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) = ${storeKey}
      GROUP BY lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')), e.barcode
    ),
    restock_totals AS (
      SELECT
        s.normalized_name AS store_key,
        r.barcode,
        SUM(
          CASE
            WHEN lv.visit_id IS NULL THEN
              r.quantity + CASE WHEN r.invoice_quantity IS NOT NULL THEN r.invoice_quantity - r.quantity ELSE 0 END
            ELSE 0
          END
        ) AS all_quantity,
        SUM(
          CASE
            WHEN lv.visit_id IS NOT NULL
              THEN
                CASE
                  WHEN r.received_at > lv.visited_at
                    OR (r.received_at = lv.visited_at AND r.created_at > lv.visit_created_at)
                    THEN r.quantity
                  ELSE 0
                END
                + CASE
                  WHEN r.invoice_quantity IS NOT NULL AND r.invoice_recorded_at > lv.visited_at
                    THEN r.invoice_quantity - r.quantity
                  ELSE 0
                END
            ELSE 0
          END
        ) AS since_visit_quantity,
        MAX(GREATEST(r.received_at, COALESCE(r.invoice_recorded_at, r.received_at))) AS updated_at
      FROM stock_restocks r
      INNER JOIN stores s ON s.id = r.store_id
      LEFT JOIN latest_visits lv
        ON lv.store_key = s.normalized_name
        AND lv.barcode = r.barcode
      WHERE s.normalized_name = ${storeKey}
      GROUP BY s.normalized_name, r.barcode
    )
    SELECT
      COALESCE(lv.store, k.store) AS store,
      COALESCE(lv.product, k.product) AS product,
      k.barcode,
      CASE
        WHEN lv.visit_id IS NOT NULL
          THEN lv.total_quantity + COALESCE(et.since_visit_quantity, 0) + COALESCE(rt.since_visit_quantity, 0)
        ELSE COALESCE(et.all_quantity, 0) + COALESCE(rt.all_quantity, 0)
      END AS "totalQuantity",
      CASE
        WHEN lv.visit_id IS NOT NULL THEN lv.display_quantity + COALESCE(et.display_quantity, 0)
        ELSE COALESCE(et.display_quantity, 0)
      END AS "displayQuantity",
      CASE
        WHEN lv.visit_id IS NOT NULL THEN lv.secondary_display_quantity + COALESCE(et.secondary_display_quantity, 0)
        ELSE COALESCE(et.secondary_display_quantity, 0)
      END AS "secondaryDisplayQuantity",
      CASE
        WHEN lv.visit_id IS NOT NULL THEN lv.warehouse_quantity + COALESCE(et.warehouse_quantity, 0)
        ELSE COALESCE(et.warehouse_quantity, 0)
      END AS "warehouseQuantity",
      COALESCE(et.entry_count, 0) AS "entryCount",
      GREATEST(lv.visited_at, et.updated_at, rt.updated_at) AS "updatedAt"
    FROM key_rows k
    LEFT JOIN latest_visits lv ON lv.store_key = k.store_key AND lv.barcode = k.barcode
    LEFT JOIN entry_totals et ON et.store_key = k.store_key AND et.barcode = k.barcode
    LEFT JOIN restock_totals rt ON rt.store_key = k.store_key AND rt.barcode = k.barcode
    ORDER BY "updatedAt" DESC, COALESCE(lv.product, k.product) ASC
    ${parsed.data.limit ? sql`LIMIT ${parsed.data.limit}` : sql``}
  `);

  res.json(
    result.rows.map((row) => ({
      ...row,
      totalQuantity: Number(row.totalQuantity),
      displayQuantity: Number(row.displayQuantity),
      secondaryDisplayQuantity: Number(row.secondaryDisplayQuantity),
      warehouseQuantity: Number(row.warehouseQuantity),
      entryCount: Number(row.entryCount),
      updatedAt: new Date(row.updatedAt).toISOString(),
    })),
  );
});

router.post("/stock-entries", async (req, res) => {
  const parsed = CreateStockEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Data stok tidak valid." });
    return;
  }

  const existing = await db
    .select()
    .from(stockEntriesTable)
    .where(eq(stockEntriesTable.clientId, parsed.data.clientId))
    .limit(1);
  if (existing[0]) {
    res.status(201).json(responseData(existing[0]));
    return;
  }

  const [created] = await db
    .insert(stockEntriesTable)
    .values({
      ...parsed.data,
      syncStatus: "pending",
    })
    .returning();

  if (!created) {
    res.status(500).json({ error: "Data stok gagal disimpan di server." });
    return;
  }

  const updated = await updateSyncStatus(created);
  res.status(201).json(responseData(updated));
});

router.post("/stock-entries/:id/retry-sync", async (req, res) => {
  const parsed = RetryStockEntrySyncParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(404).json({ error: "Data stok tidak ditemukan." });
    return;
  }

  const [entry] = await db
    .select()
    .from(stockEntriesTable)
    .where(eq(stockEntriesTable.id, parsed.data.id))
    .limit(1);
  if (!entry) {
    res.status(404).json({ error: "Data stok tidak ditemukan." });
    return;
  }

  const updated = await updateSyncStatus(entry);
  res.json(responseData(updated));
});

export default router;