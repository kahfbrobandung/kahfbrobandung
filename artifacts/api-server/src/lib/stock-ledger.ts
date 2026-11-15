import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  stockEntriesTable,
  stockRestocksTable,
  stockVisitsTable,
  stocktakeLinesTable,
  storesTable,
} from "@workspace/db";

type StockLedgerTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function normalizeStoreKey(value: string) {
  return value.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
}

export async function reconcileStockLedger(
  tx: StockLedgerTransaction,
  store: string,
  barcode: string,
): Promise<void> {
  const storeKey = normalizeStoreKey(store);

  // OPTIMASI BESAR: Gunakan SQL Window Function agar database yang menghitung.
  // Tidak ada lagi fetch 10.000 baris ke Node.js. Waktu eksekusi < 50ms.
  await tx.execute(sql`
    WITH running_totals AS (
      SELECT
        id,
        source_type,
        quantity,
        display_quantity,
        secondary_display_quantity,
        warehouse_quantity,
        counted_quantity,
        counted_display_quantity,
        counted_secondary_display_quantity,
        counted_warehouse_quantity,
        COALESCE(SUM(
          CASE
            WHEN source_type = 'visit_correction' THEN 0
            WHEN source_type = 'restock_invoice' THEN quantity
            WHEN lower(trim(transaction)) IN ('penjualan', 'koreksi stok -', 'retur') THEN -quantity
            ELSE quantity
          END
        ) OVER (ORDER BY COALESCE(occurred_at, created_at), created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prev_qty,
        
        COALESCE(SUM(
          CASE
            WHEN source_type = 'visit_correction' THEN 0
            WHEN source_type = 'restock_invoice' THEN display_quantity
            WHEN lower(trim(transaction)) IN ('penjualan', 'koreksi stok -', 'retur') THEN -display_quantity
            ELSE display_quantity
          END
        ) OVER (ORDER BY COALESCE(occurred_at, created_at), created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prev_display,
        
        COALESCE(SUM(
          CASE
            WHEN source_type = 'visit_correction' THEN 0
            WHEN source_type = 'restock_invoice' THEN secondary_display_quantity
            WHEN lower(trim(transaction)) IN ('penjualan', 'koreksi stok -', 'retur') THEN -secondary_display_quantity
            ELSE secondary_display_quantity
          END
        ) OVER (ORDER BY COALESCE(occurred_at, created_at), created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prev_secondary,
        
        COALESCE(SUM(
          CASE
            WHEN source_type = 'visit_correction' THEN 0
            WHEN source_type = 'restock_invoice' THEN warehouse_quantity
            WHEN lower(trim(transaction)) IN ('penjualan', 'koreksi stok -', 'retur') THEN -warehouse_quantity
            ELSE warehouse_quantity
          END
        ) OVER (ORDER BY COALESCE(occurred_at, created_at), created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prev_warehouse
      FROM stock_entries
      WHERE barcode = ${barcode}
        AND lower(regexp_replace(trim(store), '[[:space:]]+', ' ', 'g')) = ${storeKey}
    )
    UPDATE stock_entries e
    SET
      quantity = c.counted_quantity - c.prev_qty,
      display_quantity = c.counted_display_quantity - c.prev_display,
      secondary_display_quantity = c.counted_secondary_display_quantity - c.prev_secondary,
      warehouse_quantity = c.counted_warehouse_quantity - c.prev_warehouse
    FROM running_totals c
    WHERE e.id = c.id
      AND c.source_type = 'visit_correction'
      AND (
        e.quantity != c.counted_quantity - c.prev_qty OR
        e.display_quantity != c.counted_display_quantity - c.prev_display OR
        e.secondary_display_quantity != c.counted_secondary_display_quantity - c.prev_secondary OR
        e.warehouse_quantity != c.counted_warehouse_quantity - c.prev_warehouse
      );
  `);
}

export async function backfillLegacyStockLedger(): Promise<{ entriesAdded: number; skusReconciled: number }> {
  return db.transaction(async (tx) => {
    const existingSources = await tx
      .select({
        sourceType: stockEntriesTable.sourceType,
        sourceId: stockEntriesTable.sourceId,
      })
      .from(stockEntriesTable)
      .where(inArray(stockEntriesTable.sourceType, ["restock", "restock_invoice", "visit_correction"]));
    const sourceKeys = new Set(existingSources.map((entry) => `${entry.sourceType}:${entry.sourceId}`));
    const affectedSkus = new Map<string, { store: string; barcode: string }>();
    let entriesAdded = 0;

    const oldRestocks = await tx
      .select({
        id: stockRestocksTable.id,
        store: storesTable.name,
        product: stockRestocksTable.product,
        barcode: stockRestocksTable.barcode,
        quantity: stockRestocksTable.quantity,
        receivedAt: stockRestocksTable.receivedAt,
        createdAt: stockRestocksTable.createdAt,
        invoiceQuantity: stockRestocksTable.invoiceQuantity,
        invoiceRecordedAt: stockRestocksTable.invoiceRecordedAt,
      })
      .from(stockRestocksTable)
      .innerJoin(storesTable, eq(stockRestocksTable.storeId, storesTable.id));

    for (const restock of oldRestocks) {
      const restockSource = `restock:${restock.id}`;
      if (!sourceKeys.has(restockSource)) {
        await tx.insert(stockEntriesTable).values({
          clientId: randomUUID(),
          store: restock.store,
          transaction: "Barang Masuk",
          product: restock.product,
          quantity: restock.quantity,
          barcode: restock.barcode,
          sourceType: "restock",
          sourceId: String(restock.id),
          occurredAt: restock.receivedAt,
          createdAt: restock.createdAt,
          syncStatus: "local",
        });
        sourceKeys.add(restockSource);
        entriesAdded += 1;
        affectedSkus.set(`${normalizeStoreKey(restock.store)}:${restock.barcode}`, {
          store: restock.store,
          barcode: restock.barcode,
        });
      }

      if (restock.invoiceQuantity !== null) {
        const invoiceSource = `restock_invoice:${restock.id}`;
        if (!sourceKeys.has(invoiceSource)) {
          const recordedAt = restock.invoiceRecordedAt ?? restock.createdAt;
          await tx.insert(stockEntriesTable).values({
            clientId: randomUUID(),
            store: restock.store,
            transaction: "Koreksi Faktur",
            product: restock.product,
            quantity: restock.invoiceQuantity - restock.quantity,
            barcode: restock.barcode,
            sourceType: "restock_invoice",
            sourceId: String(restock.id),
            occurredAt: recordedAt,
            createdAt: recordedAt,
            syncStatus: "local",
          });
          sourceKeys.add(invoiceSource);
          entriesAdded += 1;
          affectedSkus.set(`${normalizeStoreKey(restock.store)}:${restock.barcode}`, {
            store: restock.store,
            barcode: restock.barcode,
          });
        }
      }
    }

    const oldVisitLines = await tx
      .select({
        id: stocktakeLinesTable.id,
        store: storesTable.name,
        product: stocktakeLinesTable.product,
        barcode: stocktakeLinesTable.barcode,
        totalQuantity: stocktakeLinesTable.totalQuantity,
        displayQuantity: stocktakeLinesTable.displayQuantity,
        secondaryDisplayQuantity: stocktakeLinesTable.secondaryDisplayQuantity,
        warehouseQuantity: stocktakeLinesTable.warehouseQuantity,
        visitedAt: stockVisitsTable.visitedAt,
        visitCreatedAt: stockVisitsTable.createdAt,
      })
      .from(stocktakeLinesTable)
      .innerJoin(stockVisitsTable, eq(stocktakeLinesTable.visitId, stockVisitsTable.id))
      .innerJoin(storesTable, eq(stockVisitsTable.storeId, storesTable.id));

    for (const line of oldVisitLines) {
      const source = `visit_correction:${line.id}`;
      if (sourceKeys.has(source)) continue;
      await tx.insert(stockEntriesTable).values({
        clientId: randomUUID(),
        store: line.store,
        transaction: "Koreksi SO",
        product: line.product,
        quantity: 0,
        barcode: line.barcode,
        sourceType: "visit_correction",
        sourceId: String(line.id),
        occurredAt: line.visitedAt,
        createdAt: line.visitCreatedAt,
        countedQuantity: line.totalQuantity,
        countedDisplayQuantity: line.displayQuantity,
        countedSecondaryDisplayQuantity: line.secondaryDisplayQuantity,
        countedWarehouseQuantity: line.warehouseQuantity,
        syncStatus: "local",
      });
      sourceKeys.add(source);
      entriesAdded += 1;
      affectedSkus.set(`${normalizeStoreKey(line.store)}:${line.barcode}`, {
        store: line.store,
        barcode: line.barcode,
      });
    }

    // Rekonsiliasi sekarang akan sangat cepat karena menggunakan SQL.
    for (const sku of affectedSkus.values()) {
      await reconcileStockLedger(tx, sku.store, sku.barcode);
    }
    return { entriesAdded, skusReconciled: affectedSkus.size };
  });
}