import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth, supabaseAdmin } from "../middlewares/auth";

const router: IRouter = Router();

// GET /api/stock-entries
router.get("/api/stock-entries", requireAuth, async (req: Request, res: Response) => {
  try {
    const store = typeof req.query.store === "string" ? req.query.store : undefined;
    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

    let query = supabaseAdmin
      .from("stock_entries")
      .select("*", { count: "exact" })
      .order("id", { ascending: false })
      .limit(limit);

    if (store) query = query.eq("store", store);

    const { data, error, count } = await query;

    if (error) {
      console.error("[stock-entries] error:", error);
      return res.status(500).json({ error: "Gagal mengambil data.", detail: error.message });
    }

    return res.json({ success: true, data: { entries: data ?? [], total: count ?? 0, limit } });
  } catch (err) {
    console.error("[stock-entries] unexpected:", err);
    return res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

// POST /api/stock-entries
router.post("/api/stock-entries", requireAuth, async (req: Request, res: Response) => {
  try {
    const { store, transaction, product, quantity, client_id } = req.body ?? {};

    if (!store || !product || typeof quantity !== "number") {
      return res.status(400).json({ error: "store, product, dan quantity wajib diisi." });
    }

    const { data, error } = await supabaseAdmin
      .from("stock_entries")
      .insert({
        store,
        transaction: transaction ?? "Input Stok",
        product,
        quantity,
        client_id: client_id ?? crypto.randomUUID(),
      })
      .select()
      .single();

    if (error) {
      console.error("[stock-entries POST] error:", error);
      return res.status(500).json({ error: "Gagal menyimpan.", detail: error.message });
    }

    return res.status(201).json({ success: true, data });
  } catch (err) {
    console.error("[stock-entries POST] unexpected:", err);
    return res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

// GET /api/stock-balances (Dialihkan ke stock_entries agar UI tidak kosong)
router.get("/api/stock-balances", requireAuth, async (req: Request, res: Response) => {
  try {
    const store = typeof req.query.store === "string" ? req.query.store : undefined;
    
    // Karena tabel stock_balances tidak ada, kita ambil dari stock_entries
    let query = supabaseAdmin.from("stock_entries").select("*").order("id", { ascending: false }).limit(100);
    if (store) query = query.eq("store", store);
    
    const { data, error } = await query;
    if (error) throw error;
    
    return res.json({ success: true, data: { balances: data ?? [] } });
  } catch (err: any) {
    console.error("[stock-balances] error:", err);
    return res.status(500).json({ error: "Gagal mengambil data saldo.", detail: err.message });
  }
});

export default router;