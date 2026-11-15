import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth, supabaseAdmin, type AuthenticatedRequest } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const toNumber = (v: unknown, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

// =========================================================================
// GET /stock-entries
// =========================================================================
router.get("/stock-entries", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    if (!userId) return res.status(401).json({ error: "Akses ditolak." });

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
      .eq("user_id", userId) // <--- FILTER PER USER
      .order("id", { ascending: false })
      .limit(limit);

    if (store) query = query.eq("store", store);

    const { data, error, count } = await query;

    if (error) {
      logger.error({ err: error, store, userId }, "GET /stock-entries failed");
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
router.post("/stock-entries", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    if (!userId) return res.status(401).json({ error: "Akses ditolak." });

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
        user_id: userId, // <--- SIMPAN USER ID
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
      logger.error({ err: error, store, product, userId }, "POST /stock-entries failed");
      return res.status(500).json({ error: "Gagal menyimpan data stok." });
    }

    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error({ err }, "POST /stock-entries unexpected error");
    return res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

// =========================================================================
// GET /stock-balances (Menggunakan Supabase RPC)
// =========================================================================
router.get("/stock-balances", requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    if (!userId) return res.status(401).json({ error: "Akses ditolak." });

    const store = isNonEmptyString(req.query.store)
      ? req.query.store.trim()
      : null; // Kirim null jika tidak ada filter toko

    // Panggil fungsi SQL yang baru (dengan parameter user_id)
    const { data, error } = await supabaseAdmin.rpc("get_stock_balances", {
      p_user_id: userId, // <--- KIRIM USER ID KE DATABASE
      p_store: store,
    });

    if (error) {
      logger.error({ err: error, store, userId }, "GET /stock-balances RPC failed");
      return res.status(500).json({ error: "Gagal mengambil data saldo." });
    }

    // Format ulang data agar sesuai dengan yang diharapkan Frontend Anda
    const balances = (data ?? []).map((row: any) => ({
      store: row.store,
      product: row.product,
      barcode: row.barcode || "-",
      totalQuantity: Number(row.total_quantity) || 0,
    }));

    return res.json(balances);
  } catch (err) {
    logger.error({ err }, "GET /stock-balances unexpected error");
    return res.status(500).json({ error: "Gagal mengambil data saldo." });
  }
});

export default router;