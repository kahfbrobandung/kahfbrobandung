import { useMemo, useRef, useState, useEffect } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSalesActivityQueryKey,
  getGetSalesMonitorQueryKey,
  getListStockBalancesQueryKey,
  getListStoresQueryKey,
  useCreateStockRestock,
  useCreateStockVisit,
  useDeleteStockRestock,
  useDeleteStockVisit,
  useListStores,
  type StockRestock,
  type StocktakeLineInput,
} from "@workspace/api-client-react";
import { useProducts } from "@/hooks/useProducts";
import { useStoreName } from "@/hooks/useStoreName";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/supabase";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ArrowLeft, Boxes, Camera, ClipboardCheck, PackagePlus, Plus, Trash2, ShoppingCart, CheckCircle2, Search, WifiOff, RefreshCw } from "lucide-react";

const OFFLINE_QUEUE_KEY = "erlangga_offline_queue";

const API_BASE_URL = "https://kahfbrobandung-7qyj.vercel.app";

const visitCartItemSchema = z.object({
  barcode: z.string().trim().min(1, "Barcode wajib diisi."),
  product: z.string().trim().min(1, "Nama produk wajib diisi."),
  quantity: z.string().regex(/^[1-9]\d*$/, "Jumlah minimal 1."),
});

const visitFormSchema = z.object({
  visitedAt: z.string().min(1, "Tanggal kunjungan wajib diisi."),
});

const restockFormSchema = z.object({
  barcode: z.string().trim().min(1, "Masukkan kode produk atau pilih produk tersimpan."),
  product: z.string().trim().min(1, "Nama produk wajib diisi."),
  quantity: z.string().regex(/^[1-9]\d*$/, "Jumlah barang masuk minimal 1."),
  receivedAt: z.string().min(1, "Waktu penerimaan wajib diisi."),
  note: z.string().max(500, "Catatan maksimal 500 karakter."),
});

type VisitCartItemValues = z.infer<typeof visitCartItemSchema>;
type VisitFormValues = z.infer<typeof visitFormSchema>;
type RestockFormValues = z.infer<typeof restockFormSchema>;

type CartItem = { barcode: string; product: string; quantity: number };
type OfflineAction = { id: string; type: "visit" | "restock"; data: any };

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function Operations() {
  const [, setLocation] = useLocation();
  const { products } = useProducts();
  const [storeName, setStoreName] = useStoreName();
  const activeStore = storeName.trim();
  const [activeTab, setActiveTab] = useState<"visit" | "restock">("visit");
  const [scannerTarget, setScannerTarget] = useState<"visit" | "restock" | null>(null);

  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const isSyncingRef = useRef(false);

  const [visitProductSelection, setVisitProductSelection] = useState("");
  const [visitSearchQuery, setVisitSearchQuery] = useState("");
  const [isVisitDropdownOpen, setIsVisitDropdownOpen] = useState(false);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const [restockProductSelection, setRestockProductSelection] = useState("");
  const [restockSearchQuery, setRestockSearchQuery] = useState("");
  const [isRestockDropdownOpen, setIsRestockDropdownOpen] = useState(false);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [customProducts, setCustomProducts] = useState<{ barcode: string; name: string }[]>([]);

  const [restockSearch, setRestockSearch] = useState("");
  const [visitDisplayLimit, setVisitDisplayLimit] = useState(5);
  const [restockDisplayLimit, setRestockDisplayLimit] = useState(5);

  // STATE BARU UNTUK RIWAYAT (Langsung dari Supabase)
  const [visitHistory, setVisitHistory] = useState<any[]>([]);
  const [isVisitLoading, setIsVisitLoading] = useState(true);
  const [restockHistory, setRestockHistory] = useState<any[]>([]);
  const [isRestockLoading, setIsRestockLoading] = useState(true);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const visitClientId = useRef<string | null>(null);
  const restockClientId = useRef<string | null>(null);

  const storesQuery = useListStores({ query: { queryKey: getListStoresQueryKey(), staleTime: 5 * 60 * 1000 } });

  const createVisit = useCreateStockVisit();
  const createRestock = useCreateStockRestock();
  const deleteVisit = useDeleteStockVisit();
  const deleteRestock = useDeleteStockRestock();

  // FUNGSI FETCH LANGSUNG DARI SUPABASE (Bypass API Client yang Error)
  const fetchVisitHistory = async () => {
    if (!activeStore) {
      setVisitHistory([]);
      setIsVisitLoading(false);
      return;
    }
    setIsVisitLoading(true);
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user?.id) return;

    const { data: storeData } = await supabase
      .from('stores')
      .select('id')
      .eq('normalizedName', activeStore.toLowerCase())
      .maybeSingle();

    if (!storeData) {
      setVisitHistory([]);
      setIsVisitLoading(false);
      return;
    }

    const { data: visits } = await supabase
      .from('stock_visits')
      .select(`
        id, client_id, visited_at, created_at,
        stores ( name ),
        stocktake_lines ( id, product, barcode, display_quantity, secondary_display_quantity, warehouse_quantity, total_quantity )
      `)
      .eq('store_id', storeData.id)
      .order('visited_at', { ascending: false })
      .limit(50);

    if (visits) {
      setVisitHistory(visits.map((v: any) => ({
        ...v,
        store: v.stores?.name || activeStore,
        lines: v.stocktake_lines || []
      })));
    }
    setIsVisitLoading(false);
  };

  const fetchRestockHistory = async () => {
    if (!activeStore) {
      setRestockHistory([]);
      setIsRestockLoading(false);
      return;
    }
    setIsRestockLoading(true);
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user?.id) return;

    const { data: storeData } = await supabase
      .from('stores')
      .select('id')
      .eq('normalizedName', activeStore.toLowerCase())
      .maybeSingle();

    if (!storeData) {
      setRestockHistory([]);
      setIsRestockLoading(false);
      return;
    }

    const { data: restocks } = await supabase
      .from('stock_restocks')
      .select(`*, stores ( name )`)
      .eq('store_id', storeData.id)
      .order('received_at', { ascending: false })
      .limit(100);

    if (restocks) {
      setRestockHistory(restocks.map((r: any) => ({
        ...r,
        store: r.stores?.name || activeStore,
        effectiveQuantity: r.invoice_quantity ?? r.quantity
      })));
    }
    setIsRestockLoading(false);
  };

  useEffect(() => {
    fetchVisitHistory();
    fetchRestockHistory();
  }, [activeStore]);

  const allProductOptions = useMemo(() => {
    const byBarcode = new Map<string, { barcode: string; name: string }>();
    for (const visit of visitHistory) {
      for (const line of visit.lines ?? []) {
        if (!byBarcode.has(line.barcode)) byBarcode.set(line.barcode, { barcode: line.barcode, name: line.product });
      }
    }
    for (const entry of restockHistory) {
      if (!byBarcode.has(entry.barcode)) byBarcode.set(entry.barcode, { barcode: entry.barcode, name: entry.product });
    }
    for (const product of products) byBarcode.set(product.barcode, { barcode: product.barcode, name: product.name });
    for (const cp of customProducts) byBarcode.set(cp.barcode, cp);
    return [...byBarcode.values()].sort((a, b) => a.name.localeCompare(b.name, "id"));
  }, [products, restockHistory, visitHistory, customProducts]);

  const filteredVisitProducts = useMemo(() => {
    if (!visitSearchQuery) return allProductOptions.slice(0, 10);
    const q = visitSearchQuery.toLowerCase();
    return allProductOptions.filter((p) => p.name.toLowerCase().includes(q) || p.barcode.includes(q)).slice(0, 15);
  }, [allProductOptions, visitSearchQuery]);

  const filteredRestockProducts = useMemo(() => {
    if (!restockSearchQuery) return allProductOptions.slice(0, 10);
    const q = restockSearchQuery.toLowerCase();
    return allProductOptions.filter((p) => p.name.toLowerCase().includes(q) || p.barcode.includes(q)).slice(0, 15);
  }, [allProductOptions, restockSearchQuery]);

  const visibleRestocks = useMemo(() => {
    const query = restockSearch.trim().toLocaleLowerCase("id-ID");
    if (!query) return restockHistory;
    return restockHistory.filter((entry) =>
      [entry.product, entry.barcode, entry.store].some((value) => value.toLocaleLowerCase("id-ID").includes(query)),
    );
  }, [restockHistory, restockSearch]);

  const visitCartForm = useForm<VisitCartItemValues>({
    resolver: zodResolver(visitCartItemSchema),
    defaultValues: { barcode: "", product: "", quantity: "" },
  });

  const visitForm = useForm<VisitFormValues>({
    resolver: zodResolver(visitFormSchema),
    defaultValues: { visitedAt: localDateTime() },
  });

  const restockForm = useForm<RestockFormValues>({
    resolver: zodResolver(restockFormSchema),
    defaultValues: { barcode: "", product: "", quantity: "", receivedAt: localDateTime(), note: "" },
  });

  const refreshAffectedData = () => {
    fetchVisitHistory();
    fetchRestockHistory();
    queryClient.invalidateQueries({ queryKey: getListStockBalancesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSalesMonitorQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSalesActivityQueryKey() });
  };

  // --- LOGIKA OFFLINE MODE ---
  const updatePendingCount = () => {
    try {
      const queue: OfflineAction[] = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
      setPendingSyncCount(queue.length);
    } catch {
      setPendingSyncCount(0);
    }
  };

  const processQueue = async () => {
    if (!navigator.onLine || isSyncingRef.current) return;
    let queue: OfflineAction[] = [];
    try {
      queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
    } catch { return; }
    if (queue.length === 0) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      toast({ title: "Menyinkronkan data offline...", description: `Mengirim ${queue.length} data ke server.` });
      const remainingQueue: OfflineAction[] = [];
      const authHeader = `Bearer ${session.access_token}`;

      for (const action of queue) {
        try {
          const endpoint = action.type === "visit" ? "/api/stock-visits" : "/api/stock-restocks";
          const res = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: authHeader },
            body: JSON.stringify(action.data),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
          remainingQueue.push(action);
        }
      }

      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remainingQueue));
      updatePendingCount();

      if (remainingQueue.length === 0) {
        toast({ title: "Sinkronisasi Selesai!", description: "Semua data offline berhasil dikirim." });
        refreshAffectedData();
      } else {
        toast({ title: "Sebagian data gagal dikirim", description: `${remainingQueue.length} data tersisa.`, variant: "destructive" });
      }
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    updatePendingCount();
    const handleOnline = () => { setIsOnline(true); processQueue(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    if (navigator.onLine) processQueue();
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const saveToOfflineQueue = (type: "visit" | "restock", data: any) => {
    try {
      const queue: OfflineAction[] = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
      queue.push({ id: crypto.randomUUID(), type, data });
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      updatePendingCount();
    } catch {
      toast({ title: "Gagal menyimpan offline", description: "Memori HP mungkin penuh.", variant: "destructive" });
    }
  };

  const handleSelectVisitProduct = (product: { barcode: string; name: string }) => {
    setVisitProductSelection(product.barcode);
    setVisitSearchQuery(product.name);
    visitCartForm.setValue("barcode", product.barcode, { shouldValidate: true });
    visitCartForm.setValue("product", product.name, { shouldValidate: true });
    setIsVisitDropdownOpen(false);
    setTimeout(() => qtyInputRef.current?.focus(), 50);
  };

  const handleSelectRestockProduct = (product: { barcode: string; name: string }) => {
    setRestockProductSelection(product.barcode);
    setRestockSearchQuery(product.name);
    restockForm.setValue("barcode", product.barcode, { shouldValidate: true });
    restockForm.setValue("product", product.name, { shouldValidate: true });
    setIsRestockDropdownOpen(false);
  };

  const setScannedBarcode = (target: "visit" | "restock", scannedValue: string) => {
    const barcode = scannedValue.trim();
    const knownProduct = allProductOptions.find((product) => product.barcode === barcode);
    if (target === "visit") {
      if (knownProduct) handleSelectVisitProduct(knownProduct);
      else {
        visitCartForm.setValue("barcode", barcode, { shouldDirty: true, shouldValidate: true });
        visitCartForm.setValue("product", "", { shouldDirty: true, shouldValidate: true });
      }
    } else {
      if (knownProduct) handleSelectRestockProduct(knownProduct);
      else {
        restockForm.setValue("barcode", barcode, { shouldDirty: true, shouldValidate: true });
        restockForm.setValue("product", "", { shouldDirty: true, shouldValidate: true });
      }
    }
    return knownProduct;
  };

  const handleScanSuccess = (code: string) => {
    if (!scannerTarget) return;
    const product = setScannedBarcode(scannerTarget, code);
    setScannerTarget(null);
    toast({ title: product ? "Barcode ditemukan" : "Barcode dibaca", description: product ? `Produk: ${product.name}` : `${code}. Isi nama produk.` });
  };

  const onAddToCart = visitCartForm.handleSubmit((values) => {
    const barcode = values.barcode.trim();
    const productName = values.product.trim();
    const qty = Number(values.quantity);

    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.barcode === barcode);
      if (existingIndex >= 0) {
        const newCart = [...prev];
        newCart[existingIndex] = { ...newCart[existingIndex], quantity: newCart[existingIndex].quantity + qty };
        return newCart;
      }
      return [...prev, { barcode, product: productName, quantity: qty }];
    });

    visitCartForm.reset({ barcode: "", product: "", quantity: "" });
    setVisitProductSelection("");
    setVisitSearchQuery("");
    toast({ title: "Masuk Keranjang", description: `+${qty} unit ${productName}` });
  });

  const onSaveVisit = visitForm.handleSubmit((values) => {
    if (!activeStore) return toast({ title: "Pilih toko dulu", variant: "destructive" });
    if (cart.length === 0) return visitForm.setError("root", { message: "Keranjang kosong. Input barang dulu." });

    const lines: StocktakeLineInput[] = cart.map((item) => ({
      barcode: item.barcode,
      product: item.product,
      displayQuantity: item.quantity,
      secondaryDisplayQuantity: 0,
      warehouseQuantity: 0,
    }));

    visitClientId.current ??= crypto.randomUUID();
    const payload = { clientId: visitClientId.current, store: activeStore, visitedAt: new Date(values.visitedAt).toISOString(), lines };

    if (!isOnline) {
      saveToOfflineQueue("visit", payload);
      visitClientId.current = null;
      setCart([]);
      visitForm.reset({ visitedAt: localDateTime() });
      return toast({ title: "Tersimpan di HP (Offline)" });
    }

    createVisit.mutate({ data: payload }, {
      onSuccess: (visit) => {
        visitClientId.current = null;
        setCart([]);
        visitForm.reset({ visitedAt: localDateTime() });
        refreshAffectedData();
        toast({ title: "Stok Dikunci!", description: `${visit.lines?.length ?? lines.length} SKU tersimpan.` });
      },
      onError: (error) => toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" }),
    });
  });

  const onSaveRestock = restockForm.handleSubmit((values) => {
    if (!activeStore) return toast({ title: "Pilih toko dulu", variant: "destructive" });
    
    restockClientId.current ??= crypto.randomUUID();
    const payload = {
      clientId: restockClientId.current, store: activeStore, product: values.product.trim(), barcode: values.barcode.trim(),
      quantity: Number(values.quantity), receivedAt: new Date(values.receivedAt).toISOString(),
      ...(values.note.trim() ? { note: values.note.trim() } : {}),
    };

    if (!isOnline) {
      saveToOfflineQueue("restock", payload);
      restockClientId.current = null;
      setRestockProductSelection("");
      setRestockSearchQuery("");
      restockForm.reset({ barcode: "", product: "", quantity: "", receivedAt: localDateTime(), note: "" });
      return toast({ title: "Tersimpan di HP (Offline)" });
    }

    createRestock.mutate({ data: payload }, {
      onSuccess: (entry) => {
        restockClientId.current = null;
        setRestockProductSelection("");
        setRestockSearchQuery("");
        restockForm.reset({ barcode: "", product: "", quantity: "", receivedAt: localDateTime(), note: "" });
        refreshAffectedData();
        toast({ title: "Barang masuk tersimpan", description: `+${entry.quantity} unit ${entry.product}` });
      },
      onError: (error) => toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" }),
    });
  });

  const onDeleteVisit = (id: number) => {
    if (!window.confirm("Hapus kunjungan stok ini?")) return;
    deleteVisit.mutate({ id }, {
      onSuccess: () => { refreshAffectedData(); toast({ title: "Kunjungan dihapus" }); },
      onError: (error) => toast({ title: "Gagal menghapus", description: error.message, variant: "destructive" }),
    });
  };

  const onDeleteRestock = (entry: StockRestock) => {
    if (!window.confirm(`Hapus penerimaan ${entry.quantity} unit ${entry.product}?`)) return;
    deleteRestock.mutate({ id: entry.id }, {
      onSuccess: () => { refreshAffectedData(); toast({ title: "Barang masuk dihapus" }); },
      onError: (error) => toast({ title: "Gagal menghapus", description: error.message, variant: "destructive" }),
    });
  };

  return (
    <main className="min-h-[100dvh] bg-sky-50/50 dark:bg-slate-950 px-4 py-6 text-slate-800 dark:text-slate-100 sm:px-6">
      <div className="mx-auto max-w-5xl">
        {(!isOnline || pendingSyncCount > 0) && (
          <div className={`mb-4 rounded-xl p-3 flex items-center justify-between text-sm font-bold shadow-sm border ${!isOnline ? "bg-red-50 text-red-700 border-red-200" : "bg-sky-100 text-sky-800 border-sky-200"}`}>
            <div className="flex items-center gap-2">
              {!isOnline ? <WifiOff className="h-5 w-5" /> : <RefreshCw className={`h-5 w-5 ${isSyncing ? "animate-spin" : ""}`} />}
              {!isOnline ? "Anda Offline. Data disimpan di HP." : isSyncing ? "Menyinkronkan data..." : `Ada ${pendingSyncCount} data belum terkirim.`}
            </div>
            {isOnline && pendingSyncCount > 0 && !isSyncing && (
              <button onClick={processQueue} className="bg-sky-600 text-white px-3 py-1 rounded-lg text-xs hover:bg-sky-700 transition-colors">Kirim Sekarang</button>
            )}
          </div>
        )}

        <header className="mb-6 flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-sky-600 hover:text-sky-800 transition-colors"><ArrowLeft className="h-4 w-4" /> Kembali</Link>
            <h1 className="font-serif text-3xl font-bold tracking-tight">Operasional</h1>
          </div>
          <button type="button" onClick={() => setLocation("/dashboard")} className="inline-flex h-10 items-center justify-center rounded-lg border border-sky-200 bg-white px-4 text-sm font-semibold text-sky-700 shadow-sm hover:bg-sky-50 transition-colors">Lihat Penjualan</button>
        </header>

        <section className="mb-6 rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
          <label htmlFor="active-store" className="mb-2 flex items-center gap-2 text-sm font-bold"><Boxes className="h-4 w-4 text-sky-600" /> Toko Aktif</label>
          <input id="active-store" list="known-stores" value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="Ketik nama toko..." required className="h-12 w-full rounded-xl border border-sky-200 bg-sky-50 px-4 text-base font-medium outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20" />
          <datalist id="known-stores">{(storesQuery.data ?? []).map((store) => <option key={store.name} value={store.name} />)}</datalist>
        </section>

        <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl bg-sky-100 p-1.5">
          <button type="button" onClick={() => setActiveTab("visit")} className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold transition-all ${activeTab === "visit" ? "bg-white text-sky-700 shadow-sm" : "text-sky-600/70 hover:text-sky-800"}`}><ClipboardCheck className="h-4 w-4" /> Kunjungan SO</button>
          <button type="button" onClick={() => setActiveTab("restock")} className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold transition-all ${activeTab === "restock" ? "bg-white text-sky-700 shadow-sm" : "text-sky-600/70 hover:text-sky-800"}`}><PackagePlus className="h-4 w-4" /> Barang Masuk</button>
        </div>

        {activeTab === "visit" ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
            <section className="flex flex-col gap-6">
              <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
                <h2 className="font-serif text-xl font-bold mb-4">Scan & Hitung</h2>
                <Form {...visitCartForm}>
                  <form onSubmit={onAddToCart} className="space-y-4">
                    <div className="relative">
                      <label className="mb-2 block text-sm font-bold">Cari / Scan Produk</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-sky-400" />
                          <input type="text" placeholder="Ketik nama produk..." value={visitSearchQuery} onChange={(e) => { setVisitSearchQuery(e.target.value); setIsVisitDropdownOpen(true); if (e.target.value === "") { setVisitProductSelection(""); visitCartForm.setValue("barcode", ""); visitCartForm.setValue("product", ""); } }} onFocus={() => setIsVisitDropdownOpen(true)} onBlur={() => setTimeout(() => setIsVisitDropdownOpen(false), 200)} className="h-12 w-full rounded-xl border border-sky-200 bg-sky-50 pl-9 pr-3 text-sm font-medium focus:border-sky-500 outline-none" />
                        </div>
                        <button type="button" onClick={() => setScannerTarget("visit")} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white shadow-sm hover:bg-sky-700"><Camera className="h-5 w-5" /></button>
                      </div>
                      {isVisitDropdownOpen && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-sky-100 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                          {filteredVisitProducts.length === 0 ? <div className="p-4 text-sm text-center text-slate-500">Produk tidak ditemukan.</div> : filteredVisitProducts.map((p) => (
                            <div key={p.barcode} onClick={() => handleSelectVisitProduct(p)} className="p-3 text-sm hover:bg-sky-50 cursor-pointer border-b border-sky-50 last:border-0">
                              <p className="font-bold">{p.name}</p><p className="text-xs text-sky-600 font-mono mt-0.5">{p.barcode}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={visitCartForm.control} name="product" render={({ field }) => (
                        <FormItem><FormLabel className="text-xs font-semibold text-sky-600">Nama Terpilih</FormLabel><FormControl><input {...field} readOnly placeholder="Auto" className="h-12 w-full rounded-xl border border-sky-200 bg-sky-100 px-3 text-sm font-medium text-slate-700" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={visitCartForm.control} name="quantity" render={({ field }) => (
                        <FormItem><FormLabel className="text-xs font-bold text-sky-700">Jumlah Fisik</FormLabel><FormControl><input {...field} ref={(e) => { field.ref(e); qtyInputRef.current = e; }} type="number" inputMode="numeric" placeholder="0" className="h-12 w-full rounded-xl border-2 border-sky-300 bg-sky-50/50 px-3 text-center text-xl font-bold text-sky-700 focus:border-sky-500 outline-none placeholder:text-sky-300" /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                    <button type="submit" className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white shadow-md hover:bg-sky-700"><Plus className="h-5 w-5" /> Tambah ke Keranjang</button>
                  </form>
                </Form>
              </div>

              <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between border-b border-sky-50 pb-3">
                  <h3 className="flex items-center gap-2 text-lg font-bold"><ShoppingCart className="h-5 w-5 text-sky-600" /> Keranjang</h3>
                  <span className="rounded-full bg-sky-100 text-sky-700 px-3 py-1 text-xs font-bold">{cart.length} SKU</span>
                </div>
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-sky-100 bg-sky-50/50 py-10">
                    <ShoppingCart className="h-10 w-10 text-sky-200 mb-3" /><p className="text-sm font-medium text-sky-600/70">Belum ada barang dihitung.</p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {cart.map((item, index) => (
                      <li key={item.barcode} className="flex items-center justify-between gap-3 rounded-xl border border-sky-100 p-3 bg-sky-50/30">
                        <div className="min-w-0"><p className="truncate text-sm font-bold">{item.product}</p><p className="mt-0.5 font-mono text-[11px] text-sky-600">{item.barcode}</p></div>
                        <div className="flex shrink-0 items-center gap-3">
                          <div className="flex flex-col items-center"><span className="text-[10px] uppercase font-bold text-sky-400">Qty</span><span className="font-mono text-2xl font-black text-sky-600 leading-none">{item.quantity}</span></div>
                          <button type="button" onClick={() => setCart((prev) => prev.filter((_, i) => i !== index))} className="rounded-lg p-2 text-sky-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-5 w-5" /></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
                <Form {...visitForm}>
                  <form onSubmit={onSaveVisit}>
                    <FormField control={visitForm.control} name="visitedAt" render={({ field }) => (
                      <FormItem className="mb-4"><FormLabel className="text-sm font-bold">Waktu Kunjungan</FormLabel><FormControl><input {...field} type="datetime-local" className="h-12 w-full rounded-xl border border-sky-200 bg-sky-50 px-3 text-sm font-medium focus:border-sky-500 outline-none" /></FormControl><FormMessage /></FormItem>
                    )} />
                    {visitForm.formState.errors.root?.message && <p className="mb-3 text-sm font-bold text-red-500">{visitForm.formState.errors.root.message}</p>}
                    <button type="submit" disabled={createVisit.isPending || cart.length === 0 || !activeStore} className="group inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-600 to-blue-700 px-4 text-base font-bold text-white shadow-lg disabled:opacity-50">
                      <CheckCircle2 className="h-6 w-6" />{createVisit.isPending ? "Mengunci..." : isOnline ? "Kunci & Simpan Kunjungan" : "Simpan (Offline)"}
                    </button>
                  </form>
                </Form>
              </div>
            </section>

            <section className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm h-fit">
              <h2 className="font-serif text-xl font-bold border-b border-sky-50 pb-3 mb-4">Riwayat Kunjungan</h2>
              <p className="mb-4 text-xs font-medium text-sky-600">{activeStore ? `Toko: ${activeStore}` : "Pilih toko terlebih dahulu."}</p>

              {isVisitLoading ? (
                <div className="space-y-3 py-3"><div className="h-16 animate-pulse rounded-xl bg-sky-100" /><div className="h-16 animate-pulse rounded-xl bg-sky-100" /></div>
              ) : visitHistory.length === 0 ? (
                <div className="rounded-xl border border-dashed border-sky-100 px-4 py-7 text-center text-sm text-sky-500">Belum ada data.</div>
              ) : (
                <>
                  <ul className="space-y-3">
                    {visitHistory.slice(0, visitDisplayLimit).map((visit) => (
                      <li key={visit.id} className="rounded-xl border border-sky-50 bg-sky-50/50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0"><p className="truncate text-sm font-bold">{visit.store}</p><p className="mt-1 text-xs text-sky-600 font-medium">{formatDate(visit.visited_at)}</p></div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="rounded-full bg-sky-100 text-sky-700 px-2.5 py-1 text-[10px] font-bold">{visit.lines?.length ?? 0} SKU</span>
                            <button type="button" onClick={() => onDeleteVisit(visit.id)} className="rounded-lg p-1.5 text-sky-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2 mt-4">
                    {visitDisplayLimit > 5 && <button type="button" onClick={() => setVisitDisplayLimit((prev) => Math.max(5, prev - 5))} className="flex-1 py-2 text-xs font-bold text-slate-500 border border-slate-200 rounded-lg">Lebih Sedikit</button>}
                    {visitDisplayLimit < visitHistory.length && <button type="button" onClick={() => setVisitDisplayLimit((prev) => prev + 5)} className="flex-1 py-2 text-xs font-bold text-sky-600 border border-sky-200 rounded-lg">Lebih Banyak</button>}
                  </div>
                </>
              )}
            </section>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1fr]">
            <section className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm h-fit">
              <h2 className="font-serif text-xl font-bold mb-4 border-b border-sky-50 pb-3">Catat Barang Masuk</h2>
              <Form {...restockForm}>
                <form onSubmit={onSaveRestock} className="space-y-4">
                  <div className="relative">
                    <label className="mb-2 block text-sm font-bold">Cari / Scan Produk</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-sky-400" />
                        <input type="text" placeholder="Ketik nama produk..." value={restockSearchQuery} onChange={(e) => { setRestockSearchQuery(e.target.value); setIsRestockDropdownOpen(true); if (e.target.value === "") { setRestockProductSelection(""); restockForm.setValue("barcode", ""); restockForm.setValue("product", ""); } }} onFocus={() => setIsRestockDropdownOpen(true)} onBlur={() => setTimeout(() => setIsRestockDropdownOpen(false), 200)} className="h-12 w-full rounded-xl border border-sky-200 bg-sky-50 pl-9 pr-3 text-sm font-medium focus:border-sky-500 outline-none" />
                      </div>
                      <button type="button" onClick={() => setScannerTarget("restock")} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white shadow-sm hover:bg-sky-700"><Camera className="h-5 w-5" /></button>
                    </div>
                    {isRestockDropdownOpen && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-sky-100 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                        {filteredRestockProducts.length === 0 ? <div className="p-4 text-sm text-center text-slate-500">Produk tidak ditemukan.</div> : filteredRestockProducts.map((p) => (
                          <div key={p.barcode} onClick={() => handleSelectRestockProduct(p)} className="p-3 text-sm hover:bg-sky-50 cursor-pointer border-b border-sky-50 last:border-0"><p className="font-bold">{p.name}</p><p className="text-xs text-sky-600 font-mono mt-0.5">{p.barcode}</p></div>
                        ))}
                      </div>
                    )}
                  </div>
                  <FormField control={restockForm.control} name="product" render={({ field }) => (
                    <FormItem><FormLabel className="text-sm font-bold">Nama Produk</FormLabel><FormControl><input {...field} onChange={(e) => { setRestockProductSelection(""); field.onChange(e); }} placeholder="Nama produk" className="h-12 w-full rounded-xl border border-sky-200 bg-sky-50 px-3 text-sm font-medium focus:border-sky-500 outline-none" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={restockForm.control} name="quantity" render={({ field }) => (
                    <FormItem><FormLabel className="text-sm font-bold text-sky-700">Jumlah Diterima</FormLabel><FormControl><input {...field} type="number" min="1" inputMode="numeric" placeholder="0" className="h-12 w-full rounded-xl border-2 border-sky-300 bg-sky-50/50 px-3 text-center text-xl font-bold text-sky-700 focus:border-sky-500 outline-none" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={restockForm.control} name="receivedAt" render={({ field }) => (
                    <FormItem><FormLabel className="text-sm font-bold">Waktu Diterima</FormLabel><FormControl><input {...field} type="datetime-local" className="h-12 w-full rounded-xl border border-sky-200 bg-sky-50 px-3 text-sm font-medium focus:border-sky-500 outline-none" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={restockForm.control} name="note" render={({ field }) => (
                    <FormItem><FormLabel className="text-sm font-bold">Catatan (Opsional)</FormLabel><FormControl><textarea {...field} rows={2} maxLength={500} placeholder="Contoh: pengiriman pagi" className="w-full resize-y rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium focus:border-sky-500 outline-none" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <button type="submit" disabled={createRestock.isPending || !activeStore} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white shadow-md hover:bg-sky-700 disabled:opacity-50">
                    <PackagePlus className="h-5 w-5" />{createRestock.isPending ? "Menyimpan..." : isOnline ? "Simpan Barang Masuk" : "Simpan (Offline)"}
                  </button>
                </form>
              </Form>
            </section>

            <section className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm h-fit">
              <h2 className="font-serif text-xl font-bold border-b border-sky-50 pb-3 mb-4">Riwayat Masuk</h2>
              <p className="mb-4 text-xs font-medium text-sky-600">{activeStore ? `Toko: ${activeStore}` : "Semua toko."}</p>
              <label className="mb-4 block"><span className="sr-only">Cari</span><input type="search" value={restockSearch} onChange={(e) => { setRestockSearch(e.target.value); setRestockDisplayLimit(5); }} placeholder="Cari produk..." className="h-10 w-full rounded-lg border border-sky-200 bg-sky-50 px-3 text-sm focus:border-sky-500 outline-none" /></label>
              {isRestockLoading ? (
                <div className="space-y-3 py-3"><div className="h-16 animate-pulse rounded-xl bg-sky-100" /><div className="h-16 animate-pulse rounded-xl bg-sky-100" /></div>
              ) : visibleRestocks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-sky-100 px-4 py-7 text-center text-sm text-sky-500">Belum ada data.</div>
              ) : (
                <>
                  <ul className="space-y-3">
                    {visibleRestocks.slice(0, restockDisplayLimit).map((entry) => (
                      <li key={entry.id} className="rounded-xl border border-sky-50 bg-sky-50/50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0"><p className="truncate text-sm font-bold">{entry.product} <span className="font-mono text-[10px] font-normal text-sky-600">· {entry.barcode}</span></p><p className="mt-1 text-xs text-sky-600 font-medium">{formatDate(entry.received_at)}</p>{entry.note && <p className="mt-1 text-xs text-slate-500 italic">{entry.note}</p>}</div>
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <span className="font-mono text-lg font-black text-sky-600">+{entry.effectiveQuantity}</span>
                            <button type="button" onClick={() => onDeleteRestock(entry)} className="inline-flex h-7 items-center gap-1 rounded-md border border-red-200 px-2 text-[10px] font-bold text-red-500 hover:bg-red-50"><Trash2 className="h-3 w-3" /> Hapus</button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2 mt-4">
                    {restockDisplayLimit > 5 && <button type="button" onClick={() => setRestockDisplayLimit((prev) => Math.max(5, prev - 5))} className="flex-1 py-2 text-xs font-bold text-slate-500 border border-slate-200 rounded-lg">Lebih Sedikit</button>}
                    {restockDisplayLimit < visibleRestocks.length && <button type="button" onClick={() => setRestockDisplayLimit((prev) => prev + 5)} className="flex-1 py-2 text-xs font-bold text-sky-600 border border-sky-200 rounded-lg">Lebih Banyak</button>}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
      <BarcodeScanner isOpen={scannerTarget !== null} onClose={() => setScannerTarget(null)} onScanSuccess={handleScanSuccess} />
    </main>
  );
}