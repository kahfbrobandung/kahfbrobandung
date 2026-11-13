import { Router, type IRouter, type Request, type Response } from "express";
// ⚠️ SESUAIKAN path import client Supabase dengan project Anda.
//    Cek: file store-sales.ts / report.ts pakai import dari mana.
import { supabaseAdmin } from "../lib/supabase";
// ⚠️ SESUAIKAN nama middleware auth dengan project Anda.
//    Kalau project Anda export-nya default, ubah jadi:
//    import requireAuth from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// ===========================================================================
// HELPER — Standar response JSON agar konsisten di semua endpoint
// ===========================================================================
function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res: Response, message: string, status = 500, detail?: unknown) {
  return res.status(status).json({
    success: false,
    error: message,
    ...(detail ? { detail } : {}),
  });
}

// ===========================================================================
// GET /api/stock-entries
// Query params opsional:
//   - store_id  (uuid)
//   - limit     (number, default 50, max 200)
//   - offset    (number, default 0)
// ===========================================================================
router.get("/api/stock-entries", requireAuth, async (req: Request, res: Response) => {
  try {
    const storeId = typeof req.query.store_id === "string" ? req.query.store_id : undefined;
    const limitRaw = Number(req.query.limit ?? 50);
    const offsetRaw = Number(req.query.offset ?? 0);

    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    let query = supabaseAdmin
      .from("stock_entries")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (storeId) query = query.eq("store_id", storeId);

    const { data, error, count } = await query;

    if (error) {
      console.error("[stock-entries] supabase error:", error);
      return fail(res, "Gagal mengambil data stock entries.", 500, error.message);
    }

    return ok(res, { entries: data ?? [], total: count ?? 0, limit, offset });
  } catch (err) {
    console.error("[stock-entries] unexpected error:", err);
    return fail(res, "Terjadi kesalahan pada server.", 500);
  }
});

// ===========================================================================
// POST /api/stock-entries
// Body:
//   {
//     store_id: string (uuid),
//     product_id: string (uuid),
//     quantity: number,
//     notes?: string
//   }
// ===========================================================================
router.post("/api/stock-entries", requireAuth, async (req: Request, res: Response) => {
  try {
    const { store_id, product_id, quantity, notes } = req.body ?? {};

    // --- Validasi input ---
    if (!store_id || typeof store_id !== "string") {
      return fail(res, "store_id wajib diisi dan berupa string.", 400);
    }
    if (!product_id || typeof product_id !== "string") {
      return fail(res, "product_id wajib diisi dan berupa string.", 400);
    }
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) {
      return fail(res, "quantity wajib berupa angka >= 0.", 400);
    }
    if (notes !== undefined && typeof notes !== "string") {
      return fail(res, "notes harus berupa string.", 400);
    }

    // --- Insert ---
    const { data, error } = await supabaseAdmin
      .from("stock_entries")
      .insert({
        store_id,
        product_id,
        quantity,
        notes: notes ?? null,
        // ⚠️ SESUAIKAN: kalau tabel Anda punya kolom created_by,
        //    aktifkan baris di bawah (req.user.id menyesuaikan middleware auth).
        // created_by: (req as any).user?.id ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error("[stock-entries POST] supabase error:", error);
      return fail(res, "Gagal menyimpan stock entry.", 500, error.message);
    }

    return ok(res, data, 201);
  } catch (err) {
    console.error("[stock-entries POST] unexpected error:", err);
    return fail(res, "Terjadi kesalahan pada server.", 500);
  }
});

// ===========================================================================
// GET /api/stock-balances
// Query params opsional:
//   - store_id (uuid)
//   - limit    (default 50, max 200)
//   - offset   (default 0)
// ===========================================================================
router.get("/api/stock-balances", requireAuth, async (req: Request, res: Response) => {
  try {
    const storeId = typeof req.query.store_id === "string" ? req.query.store_id : undefined;
    const limitRaw = Number(req.query.limit ?? 50);
    const offsetRaw = Number(req.query.offset ?? 0);

    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    let query = supabaseAdmin
      .from("stock_balances")
      .select("*", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (storeId) query = query.eq("store_id", storeId);

    const { data, error, count } = await query;

    if (error) {
      console.error("[stock-balances] supabase error:", error);
      return fail(res, "Gagal mengambil data stock balances.", 500, error.message);
    }

    return ok(res, { balances: data ?? [], total: count ?? 0, limit, offset });
  } catch (err) {
    console.error("[stock-balances] unexpected error:", err);
    return fail(res, "Terjadi kesalahan pada server.", 500);
  }
});

// ===========================================================================
// GET /api/stock-balances/:store_id/:product_id
// Ambil 1 balance spesifik (kalau ada)
// ===========================================================================
router.get(
  "/api/stock-balances/:store_id/:product_id",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { store_id, product_id } = req.params;

      if (!store_id || !product_id) {
        return fail(res, "store_id dan product_id wajib ada di URL.", 400);
      }

      const { data, error } = await supabaseAdmin
        .from("stock_balances")
        .select("*")
        .eq("store_id", store_id)
        .eq("product_id", product_id)
        .maybeSingle();

      if (error) {
        console.error("[stock-balances detail] supabase error:", error);
        return fail(res, "Gagal mengambil data stock balance.", 500, error.message);
      }

      if (!data) {
        return fail(res, "Stock balance tidak ditemukan.", 404);
      }

      return ok(res, data);
    } catch (err) {
      console.error("[stock-balances detail] unexpected error:", err);
      return fail(res, "Terjadi kesalahan pada server.", 500);
    }
  }
);

export default router;