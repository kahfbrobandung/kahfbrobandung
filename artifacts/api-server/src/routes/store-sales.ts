import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateStockRestockBody,
  CreateStockVisitBody,
  ClearStockRestockInvoiceParams,
  DeleteStockRestockParams,
  DeleteStockVisitParams,
  GetDailySalesQueryParams,
  GetDailySalesResponse,
  GetSalesActivityQueryParams,
  GetSalesActivityResponse,
  GetSalesMonitorQueryParams,
  ListStockRestocksQueryParams,
  ListStockVisitsQueryParams,
  UpdateStockRestockInvoiceBody,
  UpdateStockRestockInvoiceParams,
} from "@workspace/api-zod";
import {
  db,
  stockEntriesTable,
  stockRestocksTable,
  stocktakeLinesTable,
  stockVisitsTable,
  storesTable,
} from "@workspace/db";
import { normalizeStoreKey, reconcileStockLedger } from "../lib/stock-ledger";

const router: IRouter = Router();

function normalizeStoreName(name: string) {
  return name.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
}

function displayStoreName(name: string) {
  return name.trim().normalize("NFKC").replace(/\s+/g, " ");
}

async function resolveStore(name: string) {
  const displayName = displayStoreName(name);
  const normalizedName = normalizeStoreName(displayName);
  await db
    .insert(storesTable)
    .values({ name: displayName, normalizedName })
    .onConflictDoNothing({ target: storesTable.normalizedName });

  const [store] = await db
    .select()
    .from(storesTable)
    .where(eq(storesTable.normalizedName, normalizedName))
    .limit(1);
  return store;
}

function iso(value: Date) {
  return new Date(value).toISOString();
}

function jakartaStartOfDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const normalized = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
  return normalized === value ? date : undefined;
}

async function loadVisit(visitId: number) {
  const [visit] = await db
    .select({
      id: stockVisitsTable.id,
      clientId: stockVisitsTable.clientId,
      store: storesTable.name,
      visitedAt: stockVisitsTable.visitedAt,
      createdAt: stockVisitsTable.createdAt,
    })
    .from(stockVisitsTable)
    .innerJoin(storesTable, eq(stockVisitsTable.storeId, storesTable.id))
    .where(eq(stockVisitsTable.id, visitId))
    .limit(1);

  if (!visit) return undefined;

  const lines = await db
    .select()
    .from(stocktakeLinesTable)
    .where(eq(stocktakeLinesTable.visitId, visitId))
    .orderBy(stocktakeLinesTable.id);

  return {
    ...visit,
    visitedAt: iso(visit.visitedAt),
    createdAt: iso(visit.createdAt),
    lines,
  };
}

function emptySalesMonitor() {
  return {
    summary: {
      totalSold: 0,
      totalRestocked: 0,
      activeStores: 0,
      trackedSkus: 0,
      visitComparisons: 0,
      varianceCount: 0,
    },
    dailyTrend: [],
    stores: [],
    products: [],
    calculations: [],
  };
}

type SalesQueryRow = {
  store: string;
  product: string;
  barcode: string;
  previousVisitAt: Date;
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

router.get("/stock-visits", async (req, res) => {
  const parsed = ListStockVisitsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Parameter riwayat kunjungan tidak valid." });
    return;
  }

  const requestedStore = parsed.data.store?.trim();
  const store = requestedStore ? await db
    .select()
    .from(storesTable)
    .where(eq(storesTable.normalizedName, normalizeStoreName(requestedStore)))
    .limit(1) : undefined;
  if (requestedStore && !store?.[0]) {
    res.json([]);
    return;
  }

  const visits = await db
    .select({
      id: stockVisitsTable.id,
      clientId: stockVisitsTable.clientId,
      store: storesTable.name,
      visitedAt: stockVisitsTable.visitedAt,
      createdAt: stockVisitsTable.createdAt,
    })
    .from(stockVisitsTable)
    .innerJoin(storesTable, eq(stockVisitsTable.storeId, storesTable.id))
    .where(store?.[0] ? eq(stockVisitsTable.storeId, store[0].id) : undefined)
    .orderBy(desc(stockVisitsTable.visitedAt), desc(stockVisitsTable.id))
    .limit(parsed.data.limit ?? 100);

  if (visits.length === 0) {
    res.json([]);
    return;
  }

  const lineRows = await db
    .select()
    .from(stocktakeLinesTable)
    .where(inArray(stocktakeLinesTable.visitId, visits.map((visit) => visit.id)))
    .orderBy(stocktakeLinesTable.id);
  const linesByVisit = new Map<number, typeof lineRows>();
  for (const line of lineRows) {
    const lines = linesByVisit.get(line.visitId) ?? [];
    lines.push(line);
    linesByVisit.set(line.visitId, lines);
  }

  res.json(
    visits.map((visit) => ({
      ...visit,
      visitedAt: iso(visit.visitedAt),
      createdAt: iso(visit.createdAt),
      lines: linesByVisit.get(visit.id) ?? [],
    })),
  );
});

router.post("/stock-visits", async (req, res) => {
  const parsed = CreateStockVisitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Data kunjungan stock opname tidak valid." });
    return;
  }

  const barcodes = parsed.data.lines.map((line) => line.barcode.trim());
  if (new Set(barcodes).size !== barcodes.length) {
    res.status(400).json({ error: "Satu barcode hanya boleh dicatat sekali dalam satu kunjungan." });
    return;
  }

  const store = await resolveStore(parsed.data.store);
  if (!store) {
    res.status(500).json({ error: "Toko gagal disiapkan untuk menyimpan kunjungan." });
    return;
  }

  const visitId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(stockVisitsTable)
      .values({
        clientId: parsed.data.clientId,
        storeId: store.id,
        visitedAt: new Date(parsed.data.visitedAt),
      })
      .onConflictDoNothing({ target: stockVisitsTable.clientId })
      .returning({ id: stockVisitsTable.id });

    if (!created) {
      const [existing] = await tx
        .select({ id: stockVisitsTable.id })
        .from(stockVisitsTable)
        .where(eq(stockVisitsTable.clientId, parsed.data.clientId))
        .limit(1);
      return existing?.id;
    }

    const visitedAt = new Date(parsed.data.visitedAt);
    const lines = await tx.insert(stocktakeLinesTable).values(
      parsed.data.lines.map((line) => ({
        visitId: created.id,
        product: line.product.trim(),
        barcode: line.barcode.trim(),
        displayQuantity: line.displayQuantity,
        secondaryDisplayQuantity: line.secondaryDisplayQuantity,
        warehouseQuantity: line.warehouseQuantity,
        totalQuantity:
          line.displayQuantity + line.secondaryDisplayQuantity + line.warehouseQuantity,
      })),
    ).returning();
    await tx.insert(stockEntriesTable).values(
      lines.map((line) => ({
        clientId: randomUUID(),
        store: store.name,
        transaction: "Koreksi SO",
        product: line.product,
        quantity: 0,
        barcode: line.barcode,
        sourceType: "visit_correction",
        sourceId: String(line.id),
        occurredAt: visitedAt,
        countedQuantity: line.totalQuantity,
        countedDisplayQuantity: line.displayQuantity,
        countedSecondaryDisplayQuantity: line.secondaryDisplayQuantity,
        countedWarehouseQuantity: line.warehouseQuantity,
        syncStatus: "local",
      })),
    ).onConflictDoNothing({
      target: [stockEntriesTable.sourceType, stockEntriesTable.sourceId],
    });
    for (const barcode of new Set(lines.map((line) => line.barcode))) {
      await reconcileStockLedger(tx, store.name, barcode);
    }
    return created.id;
  });

  if (!visitId) {
    res.status(500).json({ error: "Kunjungan tidak berhasil disimpan." });
    return;
  }
  const visit = await loadVisit(visitId);
  if (!visit) {
    res.status(500).json({ error: "Kunjungan tersimpan tetapi gagal dimuat ulang." });
    return;
  }
  res.status(201).json(visit);
});

router.delete("/stock-visits/:id", async (req, res): Promise<void> => {
  const parsed = DeleteStockVisitParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "ID kunjungan tidak valid." });
    return;
  }

  const deleted = await db.transaction(async (tx) => {
    const [visit] = await tx
      .select({
        id: stockVisitsTable.id,
        store: storesTable.name,
      })
      .from(stockVisitsTable)
      .innerJoin(storesTable, eq(stockVisitsTable.storeId, storesTable.id))
      .where(eq(stockVisitsTable.id, parsed.data.id))
      .limit(1);
    if (!visit) return undefined;

    const lines = await tx
      .select({ id: stocktakeLinesTable.id, barcode: stocktakeLinesTable.barcode })
      .from(stocktakeLinesTable)
      .where(eq(stocktakeLinesTable.visitId, visit.id));
    if (lines.length) {
      await tx
        .delete(stockEntriesTable)
        .where(and(
          eq(stockEntriesTable.sourceType, "visit_correction"),
          inArray(stockEntriesTable.sourceId, lines.map((line) => String(line.id))),
        ));
    }
    await tx.delete(stockVisitsTable).where(eq(stockVisitsTable.id, visit.id));
    for (const barcode of new Set(lines.map((line) => line.barcode))) {
      await reconcileStockLedger(tx, visit.store, barcode);
    }
    return visit.id;
  });
  if (!deleted) {
    res.status(404).json({ error: "Kunjungan tidak ditemukan." });
    return;
  }
  res.sendStatus(204);
});

router.get("/stock-restocks", async (req, res) => {
  const parsed = ListStockRestocksQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Parameter riwayat barang masuk tidak valid." });
    return;
  }

  const requestedStore = parsed.data.store?.trim();
  const store = requestedStore ? await db
    .select()
    .from(storesTable)
    .where(eq(storesTable.normalizedName, normalizeStoreName(requestedStore)))
    .limit(1) : undefined;
  if (requestedStore && !store?.[0]) {
    res.json([]);
    return;
  }

  const rows = await db
    .select({
      id: stockRestocksTable.id,
      clientId: stockRestocksTable.clientId,
      store: storesTable.name,
      product: stockRestocksTable.product,
      barcode: stockRestocksTable.barcode,
      quantity: stockRestocksTable.quantity,
      receivedAt: stockRestocksTable.receivedAt,
      note: stockRestocksTable.note,
      invoiceNumber: stockRestocksTable.invoiceNumber,
      invoiceQuantity: stockRestocksTable.invoiceQuantity,
      invoiceDate: stockRestocksTable.invoiceDate,
      invoiceRecordedAt: stockRestocksTable.invoiceRecordedAt,
      createdAt: stockRestocksTable.createdAt,
    })
    .from(stockRestocksTable)
    .innerJoin(storesTable, eq(stockRestocksTable.storeId, storesTable.id))
    .where(store?.[0] ? eq(stockRestocksTable.storeId, store[0].id) : undefined)
    .orderBy(desc(stockRestocksTable.receivedAt), desc(stockRestocksTable.id))
    .limit(parsed.data.limit ?? 100);

  res.json(
    rows.map((row) => ({
      ...row,
      receivedAt: iso(row.receivedAt),
      note: row.note ?? undefined,
      invoiceRecordedAt: row.invoiceRecordedAt ? iso(row.invoiceRecordedAt) : null,
      createdAt: iso(row.createdAt),
      effectiveQuantity: row.invoiceQuantity ?? row.quantity,
    })),
  );
});

router.post("/stock-restocks", async (req, res) => {
  const parsed = CreateStockRestockBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Data barang masuk tidak valid." });
    return;
  }

  const store = await resolveStore(parsed.data.store);
  if (!store) {
    res.status(500).json({ error: "Toko gagal disiapkan untuk menyimpan barang masuk." });
    return;
  }

  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(stockRestocksTable)
      .values({
        clientId: parsed.data.clientId,
        storeId: store.id,
        product: parsed.data.product.trim(),
        barcode: parsed.data.barcode.trim(),
        quantity: parsed.data.quantity,
        receivedAt: new Date(parsed.data.receivedAt),
        note: parsed.data.note?.trim() || null,
      })
      .onConflictDoNothing({ target: stockRestocksTable.clientId })
      .returning();

    const [restock] = created
      ? [created]
      : await tx
        .select()
        .from(stockRestocksTable)
        .where(eq(stockRestocksTable.clientId, parsed.data.clientId))
        .limit(1);
    if (!restock) return undefined;

    await tx
      .insert(stockEntriesTable)
      .values({
        clientId: randomUUID(),
        store: store.name,
        transaction: "Barang Masuk",
        product: restock.product,
        quantity: restock.quantity,
        barcode: restock.barcode,
        sourceType: "restock",
        sourceId: String(restock.id),
        occurredAt: restock.receivedAt,
        syncStatus: "local",
      })
      .onConflictDoNothing({
        target: [stockEntriesTable.sourceType, stockEntriesTable.sourceId],
      });
    await reconcileStockLedger(tx, store.name, restock.barcode);
    return restock;
  });
  if (!row) {
    res.status(500).json({ error: "Barang masuk tidak berhasil disimpan." });
    return;
  }

  res.status(201).json({
    ...row,
    store: store.name,
    note: row.note ?? undefined,
    receivedAt: iso(row.receivedAt),
    createdAt: iso(row.createdAt),
    invoiceRecordedAt: row.invoiceRecordedAt ? iso(row.invoiceRecordedAt) : null,
    effectiveQuantity: row.invoiceQuantity ?? row.quantity,
  });
});

router.patch("/stock-restocks/:id/invoice", async (req, res): Promise<void> => {
  const path = UpdateStockRestockInvoiceParams.safeParse(req.params);
  const parsed = UpdateStockRestockInvoiceBody.safeParse(req.body);
  if (!path.success || !parsed.success || !parsed.data.invoiceNumber.trim()) {
    res.status(400).json({ error: "Data faktur atau ID barang masuk tidak valid." });
    return;
  }

  const recordedAt = new Date();
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(stockRestocksTable)
      .set({
        invoiceNumber: parsed.data.invoiceNumber.trim(),
        invoiceQuantity: parsed.data.invoiceQuantity,
        invoiceDate: parsed.data.invoiceDate.toISOString().slice(0, 10),
        invoiceRecordedAt: recordedAt,
      })
      .where(eq(stockRestocksTable.id, path.data.id))
      .returning();
    if (!updated) return undefined;

    const [store] = await tx
      .select({ name: storesTable.name })
      .from(storesTable)
      .where(eq(storesTable.id, updated.storeId))
      .limit(1);
    if (!store) throw new Error("Toko untuk barang masuk tidak ditemukan.");

    await tx
      .insert(stockEntriesTable)
      .values({
        clientId: randomUUID(),
        store: store.name,
        transaction: "Koreksi Faktur",
        product: updated.product,
        quantity: parsed.data.invoiceQuantity - updated.quantity,
        barcode: updated.barcode,
        sourceType: "restock_invoice",
        sourceId: String(updated.id),
        occurredAt: recordedAt,
        createdAt: recordedAt,
        syncStatus: "local",
      })
      .onConflictDoUpdate({
        target: [stockEntriesTable.sourceType, stockEntriesTable.sourceId],
        set: {
          store: store.name,
          transaction: "Koreksi Faktur",
          product: updated.product,
          quantity: parsed.data.invoiceQuantity - updated.quantity,
          barcode: updated.barcode,
          occurredAt: recordedAt,
          createdAt: recordedAt,
          syncStatus: "local",
          syncError: null,
        },
      });
    await reconcileStockLedger(tx, store.name, updated.barcode);
    return { updated, store };
  });
  if (!result) {
    res.status(404).json({ error: "Catatan barang masuk tidak ditemukan." });
    return;
  }
  const { updated, store } = result;
  res.json({
    ...updated,
    store: store?.name ?? "",
    note: updated.note ?? undefined,
    receivedAt: iso(updated.receivedAt),
    createdAt: iso(updated.createdAt),
    invoiceRecordedAt: updated.invoiceRecordedAt ? iso(updated.invoiceRecordedAt) : null,
    effectiveQuantity: updated.invoiceQuantity ?? updated.quantity,
  });
});

router.delete("/stock-restocks/:id/invoice", async (req, res): Promise<void> => {
  const parsed = ClearStockRestockInvoiceParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "ID barang masuk tidak valid." });
    return;
  }

  const updated = await db.transaction(async (tx) => {
    const [restock] = await tx
      .select()
      .from(stockRestocksTable)
      .where(eq(stockRestocksTable.id, parsed.data.id))
      .limit(1);
    if (!restock) return undefined;

    await tx
      .update(stockRestocksTable)
      .set({
        invoiceNumber: null,
        invoiceQuantity: null,
        invoiceDate: null,
        invoiceRecordedAt: null,
      })
      .where(eq(stockRestocksTable.id, restock.id));
    await tx
      .delete(stockEntriesTable)
      .where(and(
        eq(stockEntriesTable.sourceType, "restock_invoice"),
        eq(stockEntriesTable.sourceId, String(restock.id)),
      ));
    const [store] = await tx
      .select({ name: storesTable.name })
      .from(storesTable)
      .where(eq(storesTable.id, restock.storeId))
      .limit(1);
    if (store) await reconcileStockLedger(tx, store.name, restock.barcode);
    return restock.id;
  });
  if (!updated) {
    res.status(404).json({ error: "Catatan barang masuk tidak ditemukan." });
    return;
  }
  res.sendStatus(204);
});

router.delete("/stock-restocks/:id", async (req, res): Promise<void> => {
  const parsed = DeleteStockRestockParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "ID barang masuk tidak valid." });
    return;
  }

  const deleted = await db.transaction(async (tx) => {
    const [restock] = await tx
      .select({
        id: stockRestocksTable.id,
        storeId: stockRestocksTable.storeId,
        barcode: stockRestocksTable.barcode,
      })
      .from(stockRestocksTable)
      .where(eq(stockRestocksTable.id, parsed.data.id))
      .limit(1);
    if (!restock) return undefined;

    await tx
      .delete(stockEntriesTable)
      .where(and(
        inArray(stockEntriesTable.sourceType, ["restock", "restock_invoice"]),
        eq(stockEntriesTable.sourceId, String(restock.id)),
      ));
    await tx.delete(stockRestocksTable).where(eq(stockRestocksTable.id, restock.id));
    const [store] = await tx
      .select({ name: storesTable.name })
      .from(storesTable)
      .where(eq(storesTable.id, restock.storeId))
      .limit(1);
    if (store) await reconcileStockLedger(tx, store.name, restock.barcode);
    return restock.id;
  });
  if (!deleted) {
    res.status(404).json({ error: "Catatan barang masuk tidak ditemukan." });
    return;
  }
  res.sendStatus(204);
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
              COALESCE(e.occurred_at, e.created_at),
              e.created_at,
              e.id
            ) > (
              n."previousVisitAt",
              n."previousVisitCreatedAt",
              n."previousVisitId"
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
            AND e.source_type = 'manual'
            AND (
              COALESCE(e.occurred_at, e.created_at),
              e.created_at,
              e.id
            ) > (
              n."previousVisitAt",
              n."previousVisitCreatedAt",
              n."previousVisitId"
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
      WHERE n."previousVisitAt" IS NOT NULL
        AND n."currentVisitAt" >= ${from}
    )
    SELECT
      store,
      product,
      barcode,
      "previousVisitAt",
      "currentVisitAt",
      "previousStock"::int AS "previousStock",
      "restockQuantity"::int AS "restockQuantity",
      "stockEntryAdjustment"::int AS "stockEntryAdjustment",
      "currentStock"::int AS "currentStock",
      ("previousStock" + "restockQuantity" + "stockEntryAdjustment" - "currentStock")::int AS "soldQuantity",
      ("previousStock" + "restockQuantity" + "stockEntryAdjustment" - "currentStock") < 0 AS "hasStockVariance"
    FROM intervals
    ORDER BY "currentVisitAt" DESC, store, product
  `);

  const calculations = result.rows.map((row) => ({
    store: row.store,
    product: row.product,
    barcode: row.barcode,
    previousVisitAt: iso(row.previousVisitAt),
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