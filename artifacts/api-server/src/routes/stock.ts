import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth, supabaseAdmin } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Transaksi yang MENGURANGI stok
const NEGATIVE_TX = new Set(["Penjualan", "Koreksi Stok -", "Retur"]);

// Helper validasi
const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const toNumber = (v: unknown, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

// =========================================================================
// GET /stock-entries
// =========================================================================
router.get("/stock-entries", requireAuth, async (req, res) => {
  try {
    const store = isNonEmptyString(req.query.store)
      ? req.query.store.trim()
      : undefined;

    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200)
      : 50;

    let query = supabaseAdmin
      .from("stock_entries")
      .select("*", { count: "exact" })
      .order("id", { ascending: false })
      .limit(limit);

    if (store) query = query.eq("store", store);

    const { data, error, count } = await query;

    if (error) {
      logger.error({ err: error, store }, "GET /stock-entries failed");
      return res.status(500).json({ error: "Gagal mengambil data stok." });
    }

    return res.json({
      success: true,
      data: { entries: data ?? [], total: count ?? 0, limit },
    });
  } catch (err) {
    logger.error({ err }, "GET /stock-entries unexpected error");
    return res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

// =========================================================================
// POST /stock-entries
// =========================================================================
router.post("/stock-entries", requireAuth, async (req, res) => {
  try {
    const {
      store,
      transaction,
      product,
      quantity,
      clientId,
      barcode,
      displayQuantity,
      secondaryDisplayQuantity,
      warehouseQuantity,
    } = req.body ?? {};

    // Validasi ketat
    if (!isNonEmptyString(store) || !isNonEmptyString(product)) {
      return res.status(400).json({ error: "store dan product wajib diisi." });
    }
    if (typeof quantity !== "number" || !Number.isFinite(quantity)) {
      return res.status(400).json({ error: "quantity harus berupa angka." });
    }
    if (quantity === 0) {
      return res.status(400).json({ error: "quantity tidak boleh 0." });
    }
    if (barcode != null && typeof barcode !== "string") {
      return res.status(400).json({ error: "barcode harus berupa string." });
    }

    const { data, error } = await supabaseAdmin
      .from("stock_entries")
      .insert({
        store: store.trim(),
        transaction: isNonEmptyString(transaction) ? transaction : "Input Stok",
        product: product.trim(),
        quantity,
        client_id: isNonEmptyString(clientId)
          ? clientId
          : globalThis.crypto?.randomUUID(),
        barcode: barcode ?? null,
        display_quantity: toNumber(displayQuantity),
        secondary_display_quantity: toNumber(secondaryDisplayQuantity),
        warehouse_quantity: toNumber(warehouseQuantity),
      })
      .select()
      .single();

    if (error) {
      logger.error(
        { err: error, store, product },
        "POST /stock-entries failed"
      );
      return res.status(500).json({ error: "Gagal menyimpan data stok." });
    }

    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error({ err }, "POST /stock-entries unexpected error");
    return res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

// =========================================================================
// GET /stock-balances
//   🔴 FIX: requireAuth ditambahkan
//   🔴 FIX: console.log dihapus, pakai logger
//   🔴 FIX: separator key pakai null byte (hindari collision jika nama
//           toko/produk mengandung "-")
//   🟠 TODO: ganti agregasi in-memory ke SQL function (lihat catatan)
// =========================================================================
router.get("/stock-balances", requireAuth, async (req, res) => {
  try {
    const store = isNonEmptyString(req.query.store)
      ? req.query.store.trim()
      : undefined;

    // Ambil kolom seperlunya saja (jangan "*")
    let query = supabaseAdmin
      .from("stock_entries")
      .select("store, product, barcode, quantity, transaction")
      .order("id", { ascending: true })
      .limit(5000);

    if (store) query = query.eq("store", store);

    const { data, error } = await query;

    if (error) {
      logger.error({ err: error, store }, "GET /stock-balances failed");
      return res.status(500).json({ error: "Gagal mengambil data saldo." });
    }

    // Agregasi di memori (sementara — lihat catatan optimasi di bawah)
    const balancesMap = new Map<
      string,
      {
        store: string;
        product: string;
        barcode: string;
        totalQuantity: number;
      }
    >();

    for (const row of data ?? []) {
      if (!row.store || !row.product) continue;

      // Gunakan null-byte sebagai separator — aman dari collision
      const key = `${row.store}\u0000${row.product}`;

      if (!balancesMap.has(key)) {
        balancesMap.set(key, {
          store: row.store,
          product: row.product,
          barcode: row.barcode || "-",
          totalQuantity: 0,
        });
      }

      const item = balancesMap.get(key)!;
      const qty = Number(row.quantity) || 0;
      item.totalQuantity += NEGATIVE_TX.has(row.transaction) ? -qty : qty;
    }

    // Bulatkan untuk hindari floating point artifacts
    const balances = Array.from(balancesMap.values()).map((b) => ({
      ...b,
      totalQuantity: Math.round(b.totalQuantity * 100) / 100,
    }));

    // ⚠️ Shape tetap array murni — JANGAN diubah (frontend bergantung)
    return res.json(balances);
  } catch (err) {
    logger.error({ err }, "GET /stock-balances unexpected error");
    return res.status(500).json({ error: "Gagal mengambil data saldo." });
  }
});

export default router;