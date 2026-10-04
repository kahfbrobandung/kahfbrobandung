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
  const [allStores, matchingStore] = await Promise.all([
    db.select({ name: storesTable.name, normalizedName: storesTable.normalizedName }).from(storesTable),
    normalizedRequestedStore
      ? db.select({ id: storesTable.id, name: storesTable.name })
        .from(storesTable)
        .where(eq(storesTable.normalizedName, normalizedRequestedStore))
        .limit(1)
      : Promise.resolve([]),
  ]);
  const storeNameByNormalized = new Map(
    allStores.map((store) => [store.normalizedName, displayStoreName(store.name)]),
  );
  const requestedStoreId = matchingStore[0]?.id;
  const limit = parsed.data.limit;

  const stockEntryConditions = [
    gte(stockEntriesTable.createdAt, from),
    lt(stockEntriesTable.createdAt, toExclusive),
    ...(normalizedRequestedStore
      ? [sql`lower(regexp_replace(trim(${stockEntriesTable.store}), '[[:space:]]+', ' ', 'g')) = ${normalizedRequestedStore}`]
      : []),
  ];
  const stockEntries = await db
    .select()
    .from(stockEntriesTable)
    .where(and(...stockEntryConditions))
    .orderBy(desc(stockEntriesTable.createdAt), desc(stockEntriesTable.id))
    .limit(limit);

  const visits = requestedStore && !requestedStoreId
    ? []
    : await db
      .select({
        id: stockVisitsTable.id,
        store: storesTable.name,
        visitedAt: stockVisitsTable.visitedAt,
      })
      .from(stockVisitsTable)
      .innerJoin(storesTable, eq(stockVisitsTable.storeId, storesTable.id))
      .where(and(
        gte(stockVisitsTable.visitedAt, from),
        lt(stockVisitsTable.visitedAt, toExclusive),
        ...(requestedStoreId ? [eq(stockVisitsTable.storeId, requestedStoreId)] : []),
      ))
      .orderBy(desc(stockVisitsTable.visitedAt), desc(stockVisitsTable.id))
      .limit(limit);

  const restocks = requestedStore && !requestedStoreId
    ? []
    : await db
      .select({
        id: stockRestocksTable.id,
        store: storesTable.name,
        product: stockRestocksTable.product,
        barcode: stockRestocksTable.barcode,
        quantity: stockRestocksTable.quantity,
        invoiceNumber: stockRestocksTable.invoiceNumber,
        invoiceQuantity: stockRestocksTable.invoiceQuantity,
        invoiceRecordedAt: stockRestocksTable.invoiceRecordedAt,
        receivedAt: stockRestocksTable.receivedAt,
      })
      .from(stockRestocksTable)
      .innerJoin(storesTable, eq(stockRestocksTable.storeId, storesTable.id))
      .where(and(
        gte(stockRestocksTable.receivedAt, from),
        lt(stockRestocksTable.receivedAt, toExclusive),
        ...(requestedStoreId ? [eq(stockRestocksTable.storeId, requestedStoreId)] : []),
      ))
      .orderBy(desc(stockRestocksTable.receivedAt), desc(stockRestocksTable.id))
      .limit(limit);

  const visitLines = visits.length
    ? await db
      .select()
      .from(stocktakeLinesTable)
      .where(inArray(stocktakeLinesTable.visitId, visits.map((visit) => visit.id)))
      .orderBy(stocktakeLinesTable.id)
    : [];
  const linesByVisit = new Map<number, typeof visitLines>();
  for (const line of visitLines) {
    const lines = linesByVisit.get(line.visitId) ?? [];
    lines.push(line);
    linesByVisit.set(line.visitId, lines);
  }

  const activity = [
    ...stockEntries.map((entry) => ({
      id: entry.id,
      recordType: "stock_entry" as const,
      store: storeNameByNormalized.get(normalizeStoreName(entry.store)) ?? displayStoreName(entry.store),
      occurredAt: iso(entry.createdAt),
      title: `Input stok · ${entry.transaction}`,
      description: `${entry.product || "Produk"} · ${entry.barcode} · ${entry.quantity} unit`,
      quantity: entry.quantity,
      skuCount: null,
      syncStatus: entry.syncStatus,
    })),
    ...visits.map((visit) => {
      const lines = linesByVisit.get(visit.id) ?? [];
      const linePreview = lines
        .slice(0, 3)
        .map((line) => `${line.product} (${line.totalQuantity})`)
        .join(" · ");
      const remainingCount = lines.length - Math.min(lines.length, 3);
      return {
        id: visit.id,
        recordType: "stock_visit" as const,
        store: visit.store,
        occurredAt: iso(visit.visitedAt),
        title: "Kunjungan SO",
        description: `${lines.length} SKU${linePreview ? ` · ${linePreview}` : ""}${remainingCount > 0 ? ` · +${remainingCount} lainnya` : ""}`,
        quantity: null,
        skuCount: lines.length,
        syncStatus: null,
      };
    }),
    ...restocks.map((entry) => ({
      id: entry.id,
      recordType: "stock_restock" as const,
      store: entry.store,
      occurredAt: iso(entry.receivedAt),
      title: "Barang masuk",
      description: `${entry.product} · ${entry.barcode} · ${entry.quantity} unit diterima${entry.invoiceNumber ? ` · Faktur ${entry.invoiceNumber}: ${entry.invoiceQuantity} unit, koreksi ${Number(entry.invoiceQuantity) - Number(entry.quantity) >= 0 ? "+" : ""}${Number(entry.invoiceQuantity) - Number(entry.quantity)}` : ""}`,
      quantity: entry.invoiceQuantity ?? entry.quantity,
      skuCount: null,
      syncStatus: null,
    })),
  ]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime() || b.id - a.id)
    .slice(0, limit);

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

    await tx.insert(stocktakeLinesTable).values(
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
    );
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

  const [deleted] = await db
    .delete(stockVisitsTable)
    .where(eq(stockVisitsTable.id, parsed.data.id))
    .returning({ id: stockVisitsTable.id });
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

  const [created] = await db
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

  const row = created ?? (await db
    .select()
    .from(stockRestocksTable)
    .where(eq(stockRestocksTable.clientId, parsed.data.clientId))
    .limit(1))[0];
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

  const [updated] = await db
    .update(stockRestocksTable)
    .set({
      invoiceNumber: parsed.data.invoiceNumber.trim(),
      invoiceQuantity: parsed.data.invoiceQuantity,
      invoiceDate: parsed.data.invoiceDate.toISOString().slice(0, 10),
      invoiceRecordedAt: new Date(),
    })
    .where(eq(stockRestocksTable.id, path.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Catatan barang masuk tidak ditemukan." });
    return;
  }

  const [store] = await db
    .select({ name: storesTable.name })
    .from(storesTable)
    .where(eq(storesTable.id, updated.storeId))
    .limit(1);
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

  const [updated] = await db
    .update(stockRestocksTable)
    .set({
      invoiceNumber: null,
      invoiceQuantity: null,
      invoiceDate: null,
      invoiceRecordedAt: null,
    })
    .where(eq(stockRestocksTable.id, parsed.data.id))
    .returning({ id: stockRestocksTable.id });
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

  const [deleted] = await db
    .delete(stockRestocksTable)
    .where(eq(stockRestocksTable.id, parsed.data.id))
    .returning({ id: stockRestocksTable.id });
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

  let requestedStoreId: number | undefined;
  if (parsed.data.store?.trim()) {
    const [store] = await db
      .select({ id: storesTable.id })
      .from(storesTable)
      .where(eq(storesTable.normalizedName, normalizeStoreName(parsed.data.store)))
      .limit(1);
    if (!store) {
      res.json(emptySalesMonitor());
      return;
    }
    requestedStoreId = store.id;
  }

  const storeFilter = requestedStoreId
    ? sql`AND v.store_id = ${requestedStoreId}`
    : sql``;
  const result = await db.execute<SalesQueryRow>(sql`
    WITH numbered_visits AS (
      SELECT
        s.name AS store,
        v.store_id,
        v.id AS visit_id,
        v.visited_at AS "currentVisitAt",
        v.created_at AS "currentVisitCreatedAt",
        l.product,
        l.barcode,
        l.total_quantity AS "currentStock",
        LAG(v.visited_at) OVER (
          PARTITION BY v.store_id, l.barcode
          ORDER BY v.visited_at, v.created_at, v.id
        ) AS "previousVisitAt",
        LAG(v.created_at) OVER (
          PARTITION BY v.store_id, l.barcode
          ORDER BY v.visited_at, v.created_at, v.id
        ) AS "previousVisitCreatedAt",
        LAG(l.total_quantity) OVER (
          PARTITION BY v.store_id, l.barcode
          ORDER BY v.visited_at, v.created_at, v.id
        ) AS "previousStock"
      FROM stock_visits v
      INNER JOIN stores s ON s.id = v.store_id
      INNER JOIN stocktake_lines l ON l.visit_id = v.id
      WHERE v.visited_at < ${toExclusive}
      ${storeFilter}
    ),
    intervals AS (
      SELECT
        n.*,
        COALESCE((
          SELECT SUM(
            CASE
              WHEN (
                r.received_at > n."previousVisitAt"
                OR (r.received_at = n."previousVisitAt" AND r.created_at > n."previousVisitCreatedAt")
              )
              AND (
                r.received_at < n."currentVisitAt"
                OR (r.received_at = n."currentVisitAt" AND r.created_at <= n."currentVisitCreatedAt")
              )
                THEN r.quantity
              ELSE 0
            END
            +
            CASE
              WHEN r.invoice_quantity IS NOT NULL
                AND r.invoice_recorded_at > n."previousVisitAt"
                AND r.invoice_recorded_at <= n."currentVisitAt"
                THEN r.invoice_quantity - r.quantity
              ELSE 0
            END
          )
          FROM stock_restocks r
          WHERE r.store_id = n.store_id
            AND r.barcode = n.barcode
            AND (
              (
                r.received_at > n."previousVisitAt"
                OR (r.received_at = n."previousVisitAt" AND r.created_at > n."previousVisitCreatedAt")
              )
              AND (
                r.received_at < n."currentVisitAt"
                OR (r.received_at = n."currentVisitAt" AND r.created_at <= n."currentVisitCreatedAt")
              )
              OR (
                r.invoice_quantity IS NOT NULL
                AND r.invoice_recorded_at > n."previousVisitAt"
                AND r.invoice_recorded_at <= n."currentVisitAt"
              )
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
              = lower(regexp_replace(trim(n.store), '[[:space:]]+', ' ', 'g'))
            AND e.barcode = n.barcode
            AND e.created_at > n."previousVisitAt"
            AND e.created_at <= n."currentVisitAt"
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