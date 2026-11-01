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
import { reconcileStockLedger } from "../lib/stock-ledger";
import { syncStockEntryToSpreadsheet } from "../lib/stock-sync";

const router: IRouter = Router();

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
    .orderBy(
      desc(sql`COALESCE(${stockEntriesTable.occurredAt}, ${stockEntriesTable.createdAt})`),
      desc(stockEntriesTable.createdAt),
      desc(stockEntriesTable.id),
    )
    .limit(parsed.data.limit ?? 25);

  res.json(entries.map(responseData));
});

router.delete("/stock-entries/:id", async (req, res): Promise<void> => {
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
    
    // PERUBAHAN 1: Izinkan hapus untuk "manual" dan "adjustment"
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
  const result = await db.execute<LedgerBalanceRow>(sql`
    WITH ledger_totals AS (
      SELECT
        lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) AS store_key,
        e.barcode,
        SUM(
          CASE
            WHEN e.source_type IN ('visit_correction', 'restock_invoice') THEN e.quantity
            WHEN lower(trim(e.transaction)) = 'penjualan' THEN -e.quantity
            ELSE e.quantity
          END
        ) AS total_quantity,
        SUM(
          CASE
            WHEN e.source_type IN ('visit_correction', 'restock_invoice') THEN e.display_quantity
            WHEN lower(trim(e.transaction)) = 'penjualan' THEN -e.display_quantity
            ELSE e.display_quantity
          END
        ) AS display_quantity,
        SUM(
          CASE
            WHEN e.source_type IN ('visit_correction', 'restock_invoice') THEN e.secondary_display_quantity
            WHEN lower(trim(e.transaction)) = 'penjualan' THEN -e.secondary_display_quantity
            ELSE e.secondary_display_quantity
          END
        ) AS secondary_display_quantity,
        SUM(
          CASE
            WHEN e.source_type IN ('visit_correction', 'restock_invoice') THEN e.warehouse_quantity
            WHEN lower(trim(e.transaction)) = 'penjualan' THEN -e.warehouse_quantity
            ELSE e.warehouse_quantity
          END
        ) AS warehouse_quantity,
        COUNT(*) AS entry_count,
        MAX(COALESCE(e.occurred_at, e.created_at)) AS updated_at
      FROM stock_entries e
      WHERE lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) = ${storeKey}
      GROUP BY lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')), e.barcode
    ),
    latest_products AS (
      SELECT DISTINCT ON (lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')), e.barcode)
        lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) AS store_key,
        e.store,
        e.product,
        e.barcode
      FROM stock_entries e
      WHERE lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')) = ${storeKey}
      ORDER BY
        lower(regexp_replace(trim(e.store), '[[:space:]]+', ' ', 'g')),
        e.barcode,
        COALESCE(e.occurred_at, e.created_at) DESC,
        e.created_at DESC,
        e.id DESC
    )
    SELECT
      p.store,
      p.product,
      p.barcode,
      t.total_quantity AS "totalQuantity",
      t.display_quantity AS "displayQuantity",
      t.secondary_display_quantity AS "secondaryDisplayQuantity",
      t.warehouse_quantity AS "warehouseQuantity",
      t.entry_count AS "entryCount",
      t.updated_at AS "updatedAt"
    FROM ledger_totals t
    INNER JOIN latest_products p ON p.store_key = t.store_key AND p.barcode = t.barcode
    ORDER BY "updatedAt" DESC, p.product ASC
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
    // 1. Validasi Zod dengan Error Handling yang Lebih Baik
    const parsed = CreateStockEntryBody.safeParse(req.body);
    if (!parsed.success) {
      logger.warn({ body: req.body, errors: parsed.error.format() }, "Invalid stock entry payload");
      res.status(400).json({
        error: "Data stok tidak valid.",
        details: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
      });
      return;
    }

    // 2. Transaksi Database dengan Try-Catch
    const result = await db.transaction(async (tx) => {
      
      // PERUBAHAN 2: Logika penentuan minus/plus yang lebih aman
      const isKoreksiMinus = parsed.data.transaction.includes("-");
      
      const [created] = await tx
        .insert(stockEntriesTable)
        .values({
          ...parsed.data,
          // Gunakan Math.abs agar angka selalu positif dulu, lalu beri minus jika transaksinya "Koreksi -"
          quantity: isKoreksiMinus ? -Math.abs(parsed.data.quantity) : Math.abs(parsed.data.quantity),
          displayQuantity: isKoreksiMinus ? -Math.abs(parsed.data.displayQuantity) : Math.abs(parsed.data.displayQuantity),
          secondaryDisplayQuantity: isKoreksiMinus ? -Math.abs(parsed.data.secondaryDisplayQuantity) : Math.abs(parsed.data.secondaryDisplayQuantity),
          warehouseQuantity: isKoreksiMinus ? -Math.abs(parsed.data.warehouseQuantity) : Math.abs(parsed.data.warehouseQuantity),
          
          // PERUBAHAN 3: Baca dari frontend. Kalau frontend tidak kirim, baru default ke "manual"
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

    // 3. Kirim Response ke Frontend TERLEBIH DAHULU agar tidak timeout
    res.status(201).json(responseData(result.entry));

    // 4. Lakukan Sinkronisasi Spreadsheet di Background (Asynchronous)
    if (result.created) {
      // Tidak menggunakan 'await' agar frontend tidak menunggu proses ini
      void updateSyncStatus(result.entry).catch((err) => {
        logger.error({ err, entryId: result.entry?.id }, "Background sync failed");
      });
    }

  } catch (error) {
    // 5. Tangkap Error Transaksi/Database yang tidak terduga
    logger.error({ err: error, body: req.body }, "Failed to process stock entry");
    const message = error instanceof Error ? error.message : "Terjadi kesalahan pada server";
    res.status(500).json({ 
      error: "Gagal memproses data stok.", 
      details: message 
    });
  }
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
  
  // PERUBAHAN 4: Izinkan retry sync untuk adjustment juga
  if (entry.sourceType !== "manual" && entry.sourceType !== "adjustment") {
    res.status(409).json({ error: "Transaksi ini tidak disinkronkan dari input manual." });
    return;
  }

  const updated = await updateSyncStatus(entry);
  res.json(responseData(updated));
});

export default router;
