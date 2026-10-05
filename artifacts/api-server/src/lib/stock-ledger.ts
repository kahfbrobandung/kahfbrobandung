import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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

function signedMovement(entry: {
  sourceType: string;
  transaction: string;
  quantity: number;
  displayQuantity: number;
  secondaryDisplayQuantity: number;
  warehouseQuantity: number;
}) {
  const adjustmentIsSigned = entry.sourceType === "restock_invoice";
  const multiplier = !adjustmentIsSigned && entry.transaction.trim().toLocaleLowerCase("id-ID") === "penjualan"
    ? -1
    : 1;
  return {
    quantity: entry.quantity * multiplier,
    displayQuantity: entry.displayQuantity * multiplier,
    secondaryDisplayQuantity: entry.secondaryDisplayQuantity * multiplier,
    warehouseQuantity: entry.warehouseQuantity * multiplier,
  };
}

export async function reconcileStockLedger(
  tx: StockLedgerTransaction,
  store: string,
  barcode: string,
): Promise<void> {
  const storeKey = normalizeStoreKey(store);
  const entries = await tx
    .select()
    .from(stockEntriesTable)
    .where(and(
      eq(stockEntriesTable.barcode, barcode),
      sql`lower(regexp_replace(trim(${stockEntriesTable.store}), '[[:space:]]+', ' ', 'g')) = ${storeKey}`,
    ))
    .orderBy(
      asc(sql`COALESCE(${stockEntriesTable.occurredAt}, ${stockEntriesTable.createdAt})`),
      asc(stockEntriesTable.createdAt),
      asc(stockEntriesTable.id),
    );

  const correctionLineIds = entries
    .filter((entry) => entry.sourceType === "visit_correction")
    .map((entry) => Number(entry.sourceId))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  const countedLines = correctionLineIds.length
    ? await tx
      .select()
      .from(stocktakeLinesTable)
      .where(inArray(stocktakeLinesTable.id, correctionLineIds))
    : [];
  const countedLineById = new Map(countedLines.map((line) => [line.id, line]));

  let total = 0;
  let display = 0;
  let secondary = 0;
  let warehouse = 0;

  for (const entry of entries) {
    if (entry.sourceType === "visit_correction") {
      const lineId = Number(entry.sourceId);
      const line = countedLineById.get(lineId);
      if (!line) {
        throw new Error(`Stock ledger correction ${entry.id} is missing its physical count.`);
      }

      const movement = {
        quantity: line.totalQuantity - total,
        displayQuantity: line.displayQuantity - display,
        secondaryDisplayQuantity: line.secondaryDisplayQuantity - secondary,
        warehouseQuantity: line.warehouseQuantity - warehouse,
      };
      if (
        entry.quantity !== movement.quantity ||
        entry.displayQuantity !== movement.displayQuantity ||
        entry.secondaryDisplayQuantity !== movement.secondaryDisplayQuantity ||
        entry.warehouseQuantity !== movement.warehouseQuantity
      ) {
        await tx
          .update(stockEntriesTable)
          .set(movement)
          .where(eq(stockEntriesTable.id, entry.id));
      }
      total = line.totalQuantity;
      display = line.displayQuantity;
      secondary = line.secondaryDisplayQuantity;
      warehouse = line.warehouseQuantity;
      continue;
    }

    const movement = signedMovement(entry);
    total += movement.quantity;
    display += movement.displayQuantity;
    secondary += movement.secondaryDisplayQuantity;
    warehouse += movement.warehouseQuantity;
  }
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

    for (const sku of affectedSkus.values()) {
      await reconcileStockLedger(tx, sku.store, sku.barcode);
    }
    return { entriesAdded, skusReconciled: affectedSkus.size };
  });
}