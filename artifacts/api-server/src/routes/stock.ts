// GET /stock-balances (Kalkulasi Stok)
router.get("/stock-balances", requireAuth, async (req: Request, res: Response) => {
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
    
    // KEMBALIKAN FORMAT BUNGKUS (Sesuai ekspektasi Orval/Zod)
    return res.json({ success: true, data: { balances } });
  } catch (err: any) {
    return res.status(500).json({ error: "Gagal mengambil data saldo.", detail: err.message });
  }
});