import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth, supabaseAdmin } from "../middlewares/auth";

const router: IRouter = Router();

// GET /stock-entries
router.get("/stock-entries", requireAuth, async (req: Request, res: Response) => {
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
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ success: true, data: { entries: data ?? [], total: count ?? 0, limit } });
  } catch (err) {
    return res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

// POST /stock-entries
router.post("/stock-entries", requireAuth, async (req: Request, res: Response) => {
  try {
    const { 
      store, transaction, product, quantity, clientId, 
      barcode, displayQuantity, secondaryDisplayQuantity, warehouseQuantity 
    } = req.body ?? {};

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
        client_id: clientId ?? globalThis.crypto?.randomUUID(),
        barcode: barcode ?? null,
        display_quantity: displayQuantity ?? 0,
        secondary_display_quantity: secondaryDisplayQuantity ?? 0,
        warehouse_quantity: warehouseQuantity ?? 0,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

// GET /stock-balances (SEMENTARA TANPA requireAuth UNTUK TES)
router.get("/stock-balances", async (req: Request, res: Response) => { // <--- requireAuth DIHAPUS
  try {
    const store = typeof req.query.store === "string" ? req.query.store : undefined;
    
    console.log("=== API STOCK BALANCES DIPANGGIL ===");
    console.log("Nama Toko yang diterima:", store);

    let query = supabaseAdmin.from("stock_entries").select("*").order("id", { ascending: true }).limit(5000);
    if (store && store.trim() !== "") {
      query = query.eq("store", store.trim());
    }
    
    const { data, error } = await query;
    if (error) {
      console.error("Supabase Error:", error);
      return res.status(500).json({ error: error.message });
    }
    
    const balancesMap = new Map();
    for (const row of data ?? []) {
      const key = `${row.store}-${row.product}`;
      if (!balancesMap.has(key)) {
        balancesMap.set(key, {
          store: row.store,
          product: row.product,
          barcode: row.barcode || "-",
          totalQuantity: 0
        });
      }
      const item = balancesMap.get(key);
      const qty = Number(row.quantity) || 0;
      
      if (row.transaction === 'Penjualan' || row.transaction === 'Koreksi Stok -' || row.transaction === 'Retur') {
        item.totalQuantity -= qty;
      } else {
        item.totalQuantity += qty;
      }
    }
    
    const balances = Array.from(balancesMap.values());
    return res.json({ success: true, data: { balances } });
  } catch (err: any) {
    return res.status(500).json({ error: "Gagal mengambil data saldo.", detail: err.message });
  }
});

export default router;