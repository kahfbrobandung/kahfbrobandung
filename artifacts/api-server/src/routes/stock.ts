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
import { db, stockEntriesTable, storesTable, type StockEntry } from "@workspace/db";
import { logger } from "../lib/logger";
import { reconcileStockLedger } from "../lib/stock-ledger";
import { syncStockEntryToSpreadsheet } from "../lib/stock-sync";
import { normalizeStoreName } from "./helpers";

const router: IRouter = Router();

// --- FUNGSI BANTUAN KEAMANAN (Multi-Tenant) ---
async function verifyStoreOwnership(storeName: string, userId: string) {
  const [store] = await db
    .select()
    .from(storesTable)
    .where(
      and(
        eq(storesTable.normalizedName, normalizeStoreName(storeName)),
        eq(storesTable.userId, userId)
      )
    )
    .limit(1);
  return store;
}

function responseData(entry: StockEntry) {
  const {
    sourceId: _sourceId,
    countedQuantity: _countedQuantity,
    countedDisplayQuantity: _countedDisplayQuantity,
    countedSecondaryDisplayQuantity: _countedSecondaryDisplayQuantity,
    countedWarehouseQuantity: _countedWarehouseQuantity,
    ...publicEntry
  } = entry;
  return {
    ...publicEntry,
    occurredAt: (entry.occurredAt ?? entry.createdAt).toISOString(),
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
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Akses ditolak. Silakan login." });
    return;
  }

  const requestedStore = typeof req.query.store === "string" ? req.query.store.trim() : "";
  if (!requestedStore) {
    res.status(400).json({ error: "Nama toko wajib diisi untuk melihat data stok." });
    return;
  }

  const store = await verifyStoreOwnership(requestedStore, userId);
  if (!store) {
    res.status(403).json({ error: "Anda tidak memiliki akses ke toko ini." });
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
    .where(and(...conditions))
    .orderBy(
      desc(sql`COALESCE(${stockEntriesTable.occurredAt}, ${stockEntriesTable.createdAt})`),
      desc(stockEntriesTable.createdAt),
      desc(stockEntriesTable.id),
    )
    .limit(parsed.data.limit ?? 25);

  res.json(entries.map(responseData));
});

router.delete("/stock-entries/:id", async (req, res): Promise<void> => {
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Akses ditolak. Silakan login." });
    return;
  }

  const parsed = DeleteStockEntryParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "ID transaksi stok tidak valid." });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(stockEntriesTable)
      .where(eq(stockEntriesTable.id, parsed.data.id))
      .limit(1);
    if (!entry) return { kind: "missing" as const };
    
    const store = await verifyStoreOwnership(entry.store, userId);
    if (!store) return { kind: "missing" as const };

    if (entry.sourceType !== "manual" && entry.sourceType !== "adjustment") {
      return { kind: "managed" as const };
    }

    await tx.delete(stockEntriesTable).where(eq(stockEntriesTable.id, entry.id));
    await reconcileStockLedger(tx, entry.store, entry.barcode);
    return { kind: "deleted" as const, id: entry.id };
  });
  if (outcome.kind === "missing") {
    res.status(404).json({ error: "Transaksi stok tidak ditemukan." });
    return;
  }
  if (outcome.kind === "managed") {
    res.status(409).json({ error: "Transaksi ini dikelola dari riwayat kunjungan atau barang masuk." });
    return;
  }

  res.json(DeleteStockEntryResponse.parse({
    id: outcome.id,
    spreadsheetMirrorMayRemain: true,
  }));
});

// ============================================================================
// PERBAIKAN TOTAL: LOGIKA STOK SALDO (Kunjungan Terakhir + Pergerakan Setelahnya)
// ============================================================================
router.get("/stock-balances", async (req, res) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Akses ditolak. Silakan login." });
    return;
  }

  const requestedStore = typeof req.query.store === "string" ? req.query.store.trim() : "";
  if (!requestedStore) {
    res.status(400).json({ error: "Nama toko wajib diisi untuk melihat saldo SKU." });
    return;
  }

  const store = await verifyStoreOwnership(requestedStore, userId);
  if (!store) {
    res.status(403).json({ error: "Anda tidak memiliki akses ke toko ini." });
    return;
  }

  const parsed = ListStockBalancesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Parameter filter saldo tidak valid." });
    return;
  }

  const storeKey = requestedStore.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
  
  type LedgerBalanceRow = {
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

  // QUERY BARU: Ambil angka dari SO terakhir, lalu hitung selisih pergerakan setelahnya
  const result = await db.execute<LedgerBalanceRow>(sql`
    WITH latest_visits AS (
      SELECT DISTINCT ON (lower(regexp_replace(trim(store), '[[:space:]]+', ' ', 'g')), barcode)
        lower(regexp_replace(trim(store), '[[:space:]]+', ' ', 'g')) AS store_key,
        store, 
        product, 
        barcode, 
        counted_quantity AS base_quantity, 
        counted_display_quantity AS base_display_quantity,
        counted_secondary_display_quantity AS base_secondary_display_quantity,
        counted_warehouse_quantity AS base_warehouse_quantity,
        COALESCE(occurred_at, created_at) AS visit_at
      FROM stock_entries
      WHERE source_type = 'visit_correction' 
        AND counted_quantity IS NOT NULL
        AND lower(regexp_replace(trim(store), '[[:space:]]+', ' ', 'g')) = ${storeKey}
      ORDER BY 
        lower(regexp_replace(trim(store), '[[:space:]]+', ' ', 'g')), 
        barcode, 
        COALESCE(occurred_at, created_at) DESC
    ),
    movements_after_visit AS (
      SELECT
        lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) AS store_key,
        e.barcode,
        SUM(
          CASE
            WHEN e.source_type IN ('restock', 'restock_invoice') THEN e.quantity
            WHEN lower(trim(e.transaction)) = 'penjualan' THEN -e.quantity
            ELSE e.quantity
          END
        ) AS delta_quantity,
        SUM(
          CASE
            WHEN e.source_type IN ('restock', 'restock_invoice') THEN e.display_quantity
            WHEN lower(trim(e.transaction)) = 'penjualan' THEN -e.display_quantity
            ELSE e.display_quantity
          END
        ) AS delta_display_quantity,
        SUM(
          CASE
            WHEN e.source_type IN ('restock', 'restock_invoice') THEN e.secondary_display_quantity
            WHEN lower(trim(e.transaction)) = 'penjualan' THEN -e.secondary_display_quantity
            ELSE e.secondary_display_quantity
          END
        ) AS delta_secondary_display_quantity,
        SUM(
          CASE
            WHEN e.source_type IN ('restock', 'restock_invoice') THEN e.warehouse_quantity
            WHEN lower(trim(e.transaction)) = 'penjualan' THEN -e.warehouse_quantity
            ELSE e.warehouse_quantity
          END
        ) AS delta_warehouse_quantity,
        COUNT(*) AS movement_count,
        MAX(COALESCE(e.occurred_at, e.created_at)) AS last_movement_at
      FROM stock_entries e
      INNER JOIN latest_visits lv ON 
        lv.store_key = lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) 
        AND lv.barcode = e.barcode
      WHERE lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) = ${storeKey}
        AND COALESCE(e.occurred_at, e.created_at) > lv.visit_at
      GROUP BY lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')), e.barcode
    )
    SELECT 
      lv.store, 
      lv.product, 
      lv.barcode,
      (lv.base_quantity + COALESCE(m.delta_quantity, 0))::int AS "totalQuantity",
      (lv.base_display_quantity + COALESCE(m.delta_display_quantity, 0))::int AS "displayQuantity",
      (lv.base_secondary_display_quantity + COALESCE(m.delta_secondary_display_quantity, 0))::int AS "secondaryDisplayQuantity",
      (lv.base_warehouse_quantity + COALESCE(m.delta_warehouse_quantity, 0))::int AS "warehouseQuantity",
      (1 + COALESCE(m.movement_count, 0))::int AS "entryCount",
      GREATEST(lv.visit_at, COALESCE(m.last_movement_at, lv.visit_at)) AS "updatedAt"
    FROM latest_visits lv
    LEFT JOIN movements_after_visit m ON m.store_key = lv.store_key AND m.barcode = lv.barcode
    ORDER BY "updatedAt" DESC, lv.product ASC
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
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: "Akses ditolak. Silakan login." });
      return;
    }

    const parsed = CreateStockEntryBody.safeParse(req.body);
    if (!parsed.success) {
      logger.warn({ body: req.body, errors: parsed.error.format() }, "Invalid stock entry payload");
      res.status(400).json({
        error: "Data stok tidak valid.",
        details: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
      });
      return;
    }

    const store = await verifyStoreOwnership(parsed.data.store, userId);
    if (!store) {
      res.status(403).json({ error: "Anda tidak memiliki akses untuk menginput stok di toko ini." });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const isKoreksiMinus = parsed.data.transaction.includes("-");
      
      const [created] = await tx
        .insert(stockEntriesTable)
        .values({
          ...parsed.data,
          quantity: isKoreksiMinus ? -Math.abs(parsed.data.quantity) : Math.abs(parsed.data.quantity),
          displayQuantity: isKoreksiMinus ? -Math.abs(parsed.data.displayQuantity) : Math.abs(parsed.data.displayQuantity),
          secondaryDisplayQuantity: isKoreksiMinus ? -Math.abs(parsed.data.secondaryDisplayQuantity) : Math.abs(parsed.data.secondaryDisplayQuantity),
          warehouseQuantity: isKoreksiMinus ? -Math.abs(parsed.data.warehouseQuantity) : Math.abs(parsed.data.warehouseQuantity),
          
          sourceType: parsed.data.sourceType ?? "manual", 
          sourceId: null,
          occurredAt: new Date(),
          syncStatus: "pending",
        })
        .onConflictDoNothing({ target: stockEntriesTable.clientId })
        .returning();

      if (!created) {
        const [existing] = await tx
          .select()
          .from(stockEntriesTable)
          .where(eq(stockEntriesTable.clientId, parsed.data.clientId))
          .limit(1);
        return { entry: existing, created: false };
      }

      await reconcileStockLedger(tx, created.store, created.barcode);
      return { entry: created, created: true };
    });

    if (!result.entry) {
      res.status(500).json({ error: "Data stok gagal disimpan di server (tidak ada entri yang dibuat)." });
      return;
    }

    res.status(201).json(responseData(result.entry));

    if (result.created) {
      void updateSyncStatus(result.entry).catch((err) => {
        logger.error({ err, entryId: result.entry?.id }, "Background sync failed");
      });
    }

  } catch (error) {
    logger.error({ err: error, body: req.body }, "Failed to process stock entry");
    const message = error instanceof Error ? error.message : "Terjadi kesalahan pada server";
    res.status(500).json({ 
      error: "Gagal memproses data stok.", 
      details: message 
    });
  }
});

router.post("/stock-entries/:id/retry-sync", async (req, res) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Akses ditolak. Silakan login." });
    return;
  }

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
  
  const store = await verifyStoreOwnership(entry.store, userId);
  if (!store) {
    res.status(403).json({ error: "Anda tidak memiliki akses ke toko ini." });
    return;
  }
  
  if (entry.sourceType !== "manual" && entry.sourceType !== "adjustment") {
    res.status(409).json({ error: "Transaksi ini tidak disinkronkan dari input manual." });
    return;
  }

  const updated = await updateSyncStatus(entry);
  res.json(responseData(updated));
});

export default router;