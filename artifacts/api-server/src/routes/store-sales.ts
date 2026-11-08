import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateStockRestockBody,
  CreateStockVisitBody,
  ClearStockRestockInvoiceParams,
  DeleteStockRestockParams,
  DeleteStockVisitParams,
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
import { reconcileStockLedger } from "../lib/stock-ledger";
import { displayStoreName, iso, normalizeStoreName } from "./helpers";

const router: IRouter = Router();

// --- FUNGSI BANTUAN KEAMANAN (Multi-Tenant) ---
// Fungsi ini memastikan toko yang dicari benar-benar milik user yang login
async function getSecureStore(storeName: string | undefined, userId: string) {
  if (!storeName) return undefined;
  const [store] = await db
    .select()
    .from(storesTable)
    .where(
      and(
        eq(storesTable.normalizedName, normalizeStoreName(storeName)),
        eq(storesTable.userId, userId) // <-- KUNCI KEAMANAN
      )
    )
    .limit(1);
  return store;
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

router.get("/stock-visits", async (req, res) => {
  // PERHATIAN: Pastikan middleware auth kamu menyimpan user_id di req.user.id
  // Jika belum, ganti dengan cara kamu mengambil ID user dari token Supabase
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Akses ditolak. Silakan login." });
    return;
  }

  const parsed = ListStockVisitsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Parameter riwayat kunjungan tidak valid." });
    return;
  }

  const requestedStore = parsed.data.store?.trim();
  const store = await getSecureStore(requestedStore, userId);

  if (requestedStore && !store) {
    res.json([]); // Toko tidak ditemukan atau bukan milik user
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
    .where(
      store 
        ? eq(stockVisitsTable.storeId, store.id) 
        : eq(storesTable.userId, userId) // Jika tidak filter toko, ambil semua milik user
    )
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
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Akses ditolak. Silakan login." });
    return;
  }

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

  // Cek apakah toko ini milik user yang login
  const store = await getSecureStore(parsed.data.store, userId);
  if (!store) {
    res.status(403).json({ error: "Anda tidak memiliki akses ke toko ini." });
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
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Akses ditolak. Silakan login." });
    return;
  }

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
      // Pastikan kunjungan ini milik toko user yang login
      .where(and(
        eq(stockVisitsTable.id, parsed.data.id),
        eq(storesTable.userId, userId)
      ))
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
    res.status(404).json({ error: "Kunjungan tidak ditemukan atau Anda tidak berhak menghapusnya." });
    return;
  }
  res.sendStatus(204);
});

router.get("/stock-restocks", async (req, res) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Akses ditolak. Silakan login." });
    return;
  }

  const parsed = ListStockRestocksQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Parameter riwayat barang masuk tidak valid." });
    return;
  }

  const requestedStore = parsed.data.store?.trim();
  const store = await getSecureStore(requestedStore, userId);

  if (requestedStore && !store) {
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
    .where(
      store 
        ? eq(stockRestocksTable.storeId, store.id) 
        : eq(storesTable.userId, userId)
    )
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
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Akses ditolak. Silakan login." });
    return;
  }

  const parsed = CreateStockRestockBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Data barang masuk tidak valid." });
    return;
  }

  const store = await getSecureStore(parsed.data.store, userId);
  if (!store) {
    res.status(403).json({ error: "Anda tidak memiliki akses ke toko ini." });
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
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Akses ditolak. Silakan login." });
    return;
  }

  const path = UpdateStockRestockInvoiceParams.safeParse(req.params);
  const parsed = UpdateStockRestockInvoiceBody.safeParse(req.body);
  if (!path.success || !parsed.success || !parsed.data.invoiceNumber.trim()) {
    res.status(400).json({ error: "Data faktur atau ID barang masuk tidak valid." });
    return;
  }

  const recordedAt = new Date();
  const result = await db.transaction(async (tx) => {
    // Cek kepemilikan data
    const [existingRestock] = await tx
      .select({ id: stockRestocksTable.id })
      .from(stockRestocksTable)
      .innerJoin(storesTable, eq(stockRestocksTable.storeId, storesTable.id))
      .where(and(eq(stockRestocksTable.id, path.data.id), eq(storesTable.userId, userId)))
      .limit(1);

    if (!existingRestock) return undefined;

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
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Akses ditolak. Silakan login." });
    return;
  }

  const parsed = ClearStockRestockInvoiceParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "ID barang masuk tidak valid." });
    return;
  }

  const updated = await db.transaction(async (tx) => {
    // Cek kepemilikan
    const [restock] = await tx
      .select()
      .from(stockRestocksTable)
      .innerJoin(storesTable, eq(stockRestocksTable.storeId, storesTable.id))
      .where(and(eq(stockRestocksTable.id, parsed.data.id), eq(storesTable.userId, userId)))
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
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Akses ditolak. Silakan login." });
    return;
  }

  const parsed = DeleteStockRestockParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "ID barang masuk tidak valid." });
    return;
  }

  const deleted = await db.transaction(async (tx) => {
    // Cek kepemilikan
    const [restock] = await tx
      .select({
        id: stockRestocksTable.id,
        storeId: stockRestocksTable.storeId,
        barcode: stockRestocksTable.barcode,
      })
      .from(stockRestocksTable)
      .innerJoin(storesTable, eq(stockRestocksTable.storeId, storesTable.id))
      .where(and(eq(stockRestocksTable.id, parsed.data.id), eq(storesTable.userId, userId)))
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

export default router;