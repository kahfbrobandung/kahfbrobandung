import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSalesActivityQueryKey,
  getGetSalesMonitorQueryKey,
  getListStockRestocksQueryKey,
  getListStockVisitsQueryKey,
  getListStockBalancesQueryKey,
  getListStoresQueryKey,
  useCreateStockRestock,
  useCreateStockVisit,
  useDeleteStockRestock,
  useDeleteStockVisit,
  useListStockRestocks,
  useListStockVisits,
  useListStores,
  type StockRestock,
  type StocktakeLineInput,
} from "@workspace/api-client-react";
import { useProducts } from "@/hooks/useProducts";
import { useStoreName } from "@/hooks/useStoreName";
import { useToast } from "@/hooks/use-toast";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ArrowLeft, Boxes, Camera, ClipboardCheck, PackagePlus, Plus, Trash2, ShoppingCart, CheckCircle2, Search } from "lucide-react";

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
  
  // STATE UNTUK SEARCHABLE DROPDOWN KUNJUNGAN
  const [visitProductSelection, setVisitProductSelection] = useState("");
  const [visitSearchQuery, setVisitSearchQuery] = useState("");
  const [isVisitDropdownOpen, setIsVisitDropdownOpen] = useState(false);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  // STATE UNTUK SEARCHABLE DROPDOWN RESTOCK
  const [restockProductSelection, setRestockProductSelection] = useState("");
  const [restockSearchQuery, setRestockSearchQuery] = useState("");
  const [isRestockDropdownOpen, setIsRestockDropdownOpen] = useState(false);
  
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customProducts, setCustomProducts] = useState<{barcode: string, name: string}[]>([]);

  const [restockSearch, setRestockSearch] = useState("");
  const [visitDisplayLimit, setVisitDisplayLimit] = useState(5);
  const [restockDisplayLimit, setRestockDisplayLimit] = useState(5);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const visitClientId = useRef<string | null>(null);
  const restockClientId = useRef<string | null>(null);

  const storesQuery = useListStores({ query: { queryKey: getListStoresQueryKey(), staleTime: 5 * 60 * 1000 } });
  
  const visitParams = { store: activeStore || undefined, limit: 50 }; 
  const visitHistoryQuery = useListStockVisits(visitParams, {
    query: { queryKey: getListStockVisitsQueryKey(visitParams), enabled: true, staleTime: 0, refetchOnMount: "always" },
  });
  
  const restockParams = { store: activeStore || undefined, limit: 500 };
  const restockHistoryQuery = useListStockRestocks(restockParams, {
    query: { queryKey: getListStockRestocksQueryKey(restockParams), enabled: true, staleTime: 0, refetchOnMount: "always" },
  });

  const allProductOptions = useMemo(() => {
    const byBarcode = new Map<string, { barcode: string; name: string }>();
    for (const visit of visitHistoryQuery.data ?? []) {
      for (const line of visit.lines ?? []) {
        if (!byBarcode.has(line.barcode)) byBarcode.set(line.barcode, { barcode: line.barcode, name: line.product });
      }
    }
    for (const entry of restockHistoryQuery.data ?? []) {
      if (!byBarcode.has(entry.barcode)) byBarcode.set(entry.barcode, { barcode: entry.barcode, name: entry.product });
    }
    for (const product of products) byBarcode.set(product.barcode, { barcode: product.barcode, name: product.name });
    for (const cp of customProducts) byBarcode.set(cp.barcode, cp);
    return [...byBarcode.values()].sort((a, b) => a.name.localeCompare(b.name, "id"));
  }, [products, restockHistoryQuery.data, visitHistoryQuery.data, customProducts]);

  // FILTER PENCARIAN KUNJUNGAN & RESTOCK
  const filteredVisitProducts = useMemo(() => {
    if (!visitSearchQuery) return allProductOptions.slice(0, 10); // Tampilkan 10 produk pertama kalau kosong
    const q = visitSearchQuery.toLowerCase();
    return allProductOptions.filter(p => p.name.toLowerCase().includes(q) || p.barcode.includes(q)).slice(0, 15);
  }, [allProductOptions, visitSearchQuery]);

  const filteredRestockProducts = useMemo(() => {
    if (!restockSearchQuery) return allProductOptions.slice(0, 10);
    const q = restockSearchQuery.toLowerCase();
    return allProductOptions.filter(p => p.name.toLowerCase().includes(q) || p.barcode.includes(q)).slice(0, 15);
  }, [allProductOptions, restockSearchQuery]);

  const visibleRestocks = useMemo(() => {
    const query = restockSearch.trim().toLocaleLowerCase("id-ID");
    const rows = restockHistoryQuery.data ?? [];
    if (!query) return rows;
    return rows.filter((entry) => [entry.product, entry.barcode, entry.store].some((value) => value.toLocaleLowerCase("id-ID").includes(query)));
  }, [restockHistoryQuery.data, restockSearch]);

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

  const handleSelectVisitProduct = (product: { barcode: string; name: string }) => {
    setVisitProductSelection(product.barcode);
    setVisitSearchQuery(product.name);
    visitCartForm.setValue("barcode", product.barcode, { shouldValidate: true });
    visitCartForm.setValue("product", product.name, { shouldValidate: true });
    setIsVisitDropdownOpen(false);
    // Otomatis fokus ke input jumlah
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
    toast({
      title: product ? "Barcode ditemukan" : "Barcode dibaca",
      description: product ? `Produk: ${product.name}` : `${code}. Isi nama produk.`,
    });
  };

  const refreshAffectedData = () => {
    queryClient.invalidateQueries({ queryKey: getListStockVisitsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStockRestocksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStockBalancesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSalesMonitorQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSalesActivityQueryKey() });
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
      } else {
        return [...prev, { barcode, product: productName, quantity: qty }];
      }
    });

    visitCartForm.reset({ barcode: "", product: "", quantity: "" });
    setVisitProductSelection("");
    setVisitSearchQuery(""); // Reset search bar
    
    toast({ title: "Masuk Keranjang", description: `+${qty} unit ${productName}` });
  });

  const createVisit = useCreateStockVisit();
  const createRestock = useCreateStockRestock();
  const deleteVisit = useDeleteStockVisit();
  const deleteRestock = useDeleteStockRestock();

  const onSaveVisit = visitForm.handleSubmit((values) => {
    if (!activeStore) {
      toast({ title: "Pilih toko dulu", description: "Nama toko wajib diisi.", variant: "destructive" });
      return;
    }
    if (cart.length === 0) {
      visitForm.setError("root", { message: "Keranjang kosong. Input barang dulu." });
      return;
    }

    const lines: StocktakeLineInput[] = cart.map((item) => ({
      barcode: item.barcode,
      product: item.product,
      displayQuantity: item.quantity,
      secondaryDisplayQuantity: 0,
      warehouseQuantity: 0,
    }));

    visitClientId.current ??= crypto.randomUUID();
    createVisit.mutate(
      { data: { clientId: visitClientId.current, store: activeStore, visitedAt: new Date(values.visitedAt).toISOString(), lines } },
      {
        onSuccess: (visit) => {
          visitClientId.current = null;
          setCart([]);
          visitForm.reset({ visitedAt: localDateTime() });
          refreshAffectedData();
          toast({ title: "Stok Dikunci!", description: `${visit.lines?.length ?? lines.length} SKU tersimpan.` });
        },
        onError: (error) => toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" }),
      }
    );
  });

  const onSaveRestock = restockForm.handleSubmit((values) => {
    if (!activeStore) {
      toast({ title: "Pilih toko dulu", description: "Nama toko wajib diisi.", variant: "destructive" });
      return;
    }
    restockClientId.current ??= crypto.randomUUID();
    createRestock.mutate(
      { data: { clientId: restockClientId.current, store: activeStore, product: values.product.trim(), barcode: values.barcode.trim(), quantity: Number(values.quantity), receivedAt: new Date(values.receivedAt).toISOString(), ...(values.note.trim() ? { note: values.note.trim() } : {}) } },
      {
        onSuccess: (entry) => {
          restockClientId.current = null;
          setRestockProductSelection("");
          setRestockSearchQuery("");
          restockForm.reset({ barcode: "", product: "", quantity: "", receivedAt: localDateTime(), note: "" });
          refreshAffectedData();
          toast({ title: "Barang masuk tersimpan", description: `+${entry.quantity} unit ${entry.product}` });
        },
        onError: (error) => toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" }),
      }
    );
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
    <main className="min-h-[100dvh] bg-[#f8f9fa] px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" /> Kembali
            </Link>
            <h1 className="font-serif text-3xl font-bold tracking-tight text-gray-900">Operasional</h1>
          </div>
          
          <button type="button" onClick={() => setLocation("/dashboard")} className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold shadow-sm hover:bg-gray-50 transition-colors">
            Lihat Penjualan
          </button>
        </header>

        <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <label htmlFor="active-store" className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-800">
            <Boxes className="h-4 w-4 text-primary" /> Toko Aktif
          </label>
          <input id="active-store" list="known-stores" value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="Ketik nama toko..." required className="h-12 w-full rounded-xl border border-gray-300 bg-gray-50 px-4 text-base font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all" />
          <datalist id="known-stores">
            {(storesQuery.data ?? []).map((store) => <option key={store.name} value={store.name} />)}
          </datalist>
        </section>

        <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl bg-gray-200/60 p-1.5">
          <button type="button" onClick={() => setActiveTab("visit")} className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold transition-all duration-200 ${activeTab === "visit" ? "bg-white text-primary shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
            <ClipboardCheck className="h-4 w-4" /> Kunjungan SO
          </button>
          <button type="button" onClick={() => setActiveTab("restock")} className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold transition-all duration-200 ${activeTab === "restock" ? "bg-white text-primary shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
            <PackagePlus className="h-4 w-4" /> Barang Masuk
          </button>
        </div>

        {activeTab === "visit" ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
            <section className="flex flex-col gap-6">
              
              {/* FORM INPUT SCAN */}
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <h2 className="font-serif text-xl font-bold text-gray-900 mb-4">Scan & Hitung</h2>
                <Form {...visitCartForm}>
                  <form onSubmit={onAddToCart} className="space-y-4">
                    
                    {/* SEARCHABLE DROPDOWN KUNJUNGAN */}
                    <div className="relative">
                      <label className="mb-2 block text-sm font-bold text-gray-700">Cari / Scan Produk</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                          <input
                            type="text"
                            placeholder="Ketik nama produk / barcode..."
                            value={visitSearchQuery}
                            onChange={(e) => {
                              setVisitSearchQuery(e.target.value);
                              setIsVisitDropdownOpen(true);
                              if (e.target.value === "") {
                                setVisitProductSelection("");
                                visitCartForm.setValue("barcode", "");
                                visitCartForm.setValue("product", "");
                              }
                            }}
                            onFocus={() => setIsVisitDropdownOpen(true)}
                            onBlur={() => setTimeout(() => setIsVisitDropdownOpen(false), 200)}
                            className="h-12 w-full rounded-xl border border-gray-300 bg-gray-50 pl-9 pr-3 text-sm font-medium focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                          />
                        </div>
                        <button type="button" onClick={() => setScannerTarget("visit")} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm hover:opacity-90 transition-opacity">
                          <Camera className="h-5 w-5" />
                        </button>
                      </div>

                      {/* DROPDOWN LIST KUNJUNGAN */}
                      {isVisitDropdownOpen && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                          {filteredVisitProducts.length === 0 ? (
                            <div className="p-4 text-sm text-center text-gray-500">Produk tidak ditemukan.</div>
                          ) : (
                            filteredVisitProducts.map((p) => (
                              <div
                                key={p.barcode}
                                onClick={() => handleSelectVisitProduct(p)}
                                className="p-3 text-sm hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0"
                              >
                                <p className="font-bold text-gray-900">{p.name}</p>
                                <p className="text-xs text-gray-500 font-mono mt-0.5">{p.barcode}</p>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={visitCartForm.control} name="product" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold text-gray-500">Nama Terpilih</FormLabel>
                          <FormControl><input {...field} readOnly placeholder="Auto" className="h-12 w-full rounded-xl border border-gray-200 bg-gray-100 px-3 text-sm font-medium text-gray-600" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={visitCartForm.control} name="quantity" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-bold text-primary">Jumlah Fisik</FormLabel>
                          <FormControl>
                            <input 
                              {...field} 
                              ref={(e) => {
                                field.ref(e); // Hubungkan ref react-hook-form
                                qtyInputRef.current = e; // Simpan ref buat auto-focus
                              }}
                              type="number" 
                              inputMode="numeric" 
                              placeholder="0" 
                              className="h-12 w-full rounded-xl border-2 border-primary/40 bg-blue-50/30 px-3 text-center text-xl font-bold text-primary focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-primary/30" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    <button type="submit" className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 text-sm font-bold text-white shadow-md hover:bg-gray-800 active:scale-[0.98] transition-all">
                      <Plus className="h-5 w-5" /> Tambah ke Keranjang
                    </button>
                  </form>
                </Form>
              </div>

              {/* KERANJANG */}
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3">
                  <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                    <ShoppingCart className="h-5 w-5 text-primary" /> Keranjang
                  </h3>
                  <span className="rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-bold">{cart.length} SKU</span>
                </div>

                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 py-10">
                    <ShoppingCart className="h-10 w-10 text-gray-300 mb-3" />
                    <p className="text-sm font-medium text-gray-500">Belum ada barang dihitung.</p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {cart.map((item, index) => (
                      <li key={item.barcode} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-3 hover:border-primary/30 transition-colors bg-white">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-gray-900">{item.product}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-gray-500">{item.barcode}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <div className="flex flex-col items-center">
                            <span className="text-[10px] uppercase font-bold text-gray-400">Qty</span>
                            <span className="font-mono text-2xl font-black text-primary leading-none">{item.quantity}</span>
                          </div>
                          <button type="button" onClick={() => setCart((prev) => prev.filter((_, i) => i !== index))} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* SIMPAN KUNJUNGAN */}
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <Form {...visitForm}>
                  <form onSubmit={onSaveVisit}>
                    <FormField control={visitForm.control} name="visitedAt" render={({ field }) => (
                        <FormItem className="mb-4">
                          <FormLabel className="text-sm font-bold text-gray-700">Waktu Kunjungan</FormLabel>
                          <FormControl>
                            <input {...field} type="datetime-local" className="h-12 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm font-medium focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {visitForm.formState.errors.root?.message && (
                      <p className="mb-3 text-sm font-bold text-red-500">{visitForm.formState.errors.root.message}</p>
                    )}
                    <button type="submit" disabled={createVisit.isPending || cart.length === 0} className="group inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-bold text-white shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 disabled:opacity-50 disabled:shadow-none active:scale-[0.98]">
                      <CheckCircle2 className="h-6 w-6 transition-transform group-hover:scale-110" />
                      {createVisit.isPending ? "Mengunci..." : "Kunci & Simpan Kunjungan"}
                    </button>
                  </form>
                </Form>
              </div>

            </section>

            {/* RIWAYAT KUNJUNGAN */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm h-fit">
              <h2 className="font-serif text-xl font-bold text-gray-900 border-b border-gray-100 pb-3 mb-4">Riwayat Kunjungan</h2>
              <p className="mb-4 text-xs font-medium text-gray-500">{activeStore ? `Toko: ${activeStore}` : "Pilih toko terlebih dahulu."}</p>
              
              {visitHistoryQuery.isLoading ? (
                <div className="space-y-3 py-3"><div className="h-16 animate-pulse rounded-xl bg-gray-100" /><div className="h-16 animate-pulse rounded-xl bg-gray-100" /></div>
              ) : visitHistoryQuery.isError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center"><p className="text-sm font-semibold text-red-600">Gagal memuat riwayat</p><button type="button" onClick={() => visitHistoryQuery.refetch()} className="mt-2 text-xs font-bold text-primary underline">Coba lagi</button></div>
              ) : (visitHistoryQuery.data ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-7 text-center text-sm text-gray-500">Belum ada data.</div>
              ) : (
                <>
                  <ul className="space-y-3">
                    {(visitHistoryQuery.data ?? []).slice(0, visitDisplayLimit).map((visit) => (
                      <li key={visit.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 hover:bg-white hover:border-gray-200 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-gray-900">{visit.store}</p>
                            <p className="mt-1 text-xs text-gray-500 font-medium">{formatDate(visit.visitedAt)}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="rounded-full bg-primary/10 text-primary px-2.5 py-1 text-[10px] font-bold">{visit.lines?.length ?? 0} SKU</span>
                            <button type="button" onClick={() => onDeleteVisit(visit.id)} disabled={deleteVisit.isPending} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2 mt-4">
                    {visitDisplayLimit > 5 && <button type="button" onClick={() => setVisitDisplayLimit(prev => Math.max(5, prev - 5))} className="flex-1 py-2 text-xs font-bold text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Lebih Sedikit</button>}
                    {visitDisplayLimit < (visitHistoryQuery.data ?? []).length && <button type="button" onClick={() => setVisitDisplayLimit(prev => prev + 5)} className="flex-1 py-2 text-xs font-bold text-primary border border-primary/20 rounded-lg hover:bg-primary/5 transition-colors">Lebih Banyak</button>}
                  </div>
                </>
              )}
            </section>
          </div>
        ) : (
          // TAB BARANG MASUK
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1fr]">
             <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm h-fit">
              <h2 className="font-serif text-xl font-bold text-gray-900 mb-4 border-b border-gray-100 pb-3">Catat Barang Masuk</h2>
              <Form {...restockForm}>
                <form onSubmit={onSaveRestock} className="space-y-4">
                  
                  {/* SEARCHABLE DROPDOWN RESTOCK */}
                  <div className="relative">
                    <label className="mb-2 block text-sm font-bold text-gray-700">Cari / Scan Produk</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Ketik nama produk / barcode..."
                          value={restockSearchQuery}
                          onChange={(e) => {
                            setRestockSearchQuery(e.target.value);
                            setIsRestockDropdownOpen(true);
                            if (e.target.value === "") {
                              setRestockProductSelection("");
                              restockForm.setValue("barcode", "");
                              restockForm.setValue("product", "");
                            }
                          }}
                          onFocus={() => setIsRestockDropdownOpen(true)}
                          onBlur={() => setTimeout(() => setIsRestockDropdownOpen(false), 200)}
                          className="h-12 w-full rounded-xl border border-gray-300 bg-gray-50 pl-9 pr-3 text-sm font-medium focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                        />
                      </div>
                      <button type="button" onClick={() => setScannerTarget("restock")} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-900 text-white shadow-sm hover:bg-gray-800 transition-colors">
                        <Camera className="h-5 w-5" />
                      </button>
                    </div>

                    {/* DROPDOWN LIST RESTOCK */}
                    {isRestockDropdownOpen && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                        {filteredRestockProducts.length === 0 ? (
                          <div className="p-4 text-sm text-center text-gray-500">Produk tidak ditemukan.</div>
                        ) : (
                          filteredRestockProducts.map((p) => (
                            <div
                              key={p.barcode}
                              onClick={() => handleSelectRestockProduct(p)}
                              className="p-3 text-sm hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0"
                            >
                              <p className="font-bold text-gray-900">{p.name}</p>
                              <p className="text-xs text-gray-500 font-mono mt-0.5">{p.barcode}</p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <FormField control={restockForm.control} name="product" render={({ field }) => (
                      <FormItem><FormLabel className="text-sm font-bold text-gray-700">Nama Produk</FormLabel><FormControl><input {...field} onChange={(event) => { setRestockProductSelection(""); field.onChange(event); }} placeholder="Nama produk" className="h-12 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm font-medium focus:border-primary outline-none" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={restockForm.control} name="quantity" render={({ field }) => (
                      <FormItem><FormLabel className="text-sm font-bold text-primary">Jumlah Diterima</FormLabel><FormControl><input {...field} type="number" min="1" step="1" inputMode="numeric" placeholder="0" className="h-12 w-full rounded-xl border-2 border-primary/40 bg-blue-50/30 px-3 text-center text-xl font-bold text-primary focus:border-primary outline-none" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={restockForm.control} name="receivedAt" render={({ field }) => (
                      <FormItem><FormLabel className="text-sm font-bold text-gray-700">Waktu Diterima</FormLabel><FormControl><input {...field} type="datetime-local" className="h-12 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm font-medium focus:border-primary outline-none" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={restockForm.control} name="note" render={({ field }) => (
                      <FormItem><FormLabel className="text-sm font-bold text-gray-700">Catatan (Opsional)</FormLabel><FormControl><textarea {...field} rows={2} maxLength={500} placeholder="Contoh: pengiriman pagi" className="w-full resize-y rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-medium focus:border-primary outline-none" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <button type="submit" disabled={createRestock.isPending || !activeStore} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-white shadow-md hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"><PackagePlus className="h-5 w-5" />{createRestock.isPending ? "Menyimpan..." : "Simpan Barang Masuk"}</button>
                </form>
              </Form>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm h-fit">
              <h2 className="font-serif text-xl font-bold text-gray-900 border-b border-gray-100 pb-3 mb-4">Riwayat Masuk</h2>
              <p className="mb-4 text-xs font-medium text-gray-500">{activeStore ? `Toko: ${activeStore}` : "Semua toko."}</p>
              <label className="mb-4 block"><span className="sr-only">Cari</span><input type="search" value={restockSearch} onChange={(event) => { setRestockSearch(event.target.value); setRestockDisplayLimit(5); }} placeholder="Cari produk..." className="h-10 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 text-sm focus:border-primary outline-none" /></label>
              {restockHistoryQuery.isLoading ? (
                <div className="space-y-3 py-3"><div className="h-16 animate-pulse rounded-xl bg-gray-100" /><div className="h-16 animate-pulse rounded-xl bg-gray-100" /></div>
              ) : visibleRestocks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-7 text-center text-sm text-gray-500">Belum ada data.</div>
              ) : (
                <>
                <ul className="space-y-3">
                  {visibleRestocks.slice(0, restockDisplayLimit).map((entry) => (
                    <li key={entry.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 hover:bg-white transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-gray-900">{entry.product} <span className="font-mono text-[10px] font-normal text-gray-500">· {entry.barcode}</span></p>
                          <p className="mt-1 text-xs text-gray-500 font-medium">{formatDate(entry.receivedAt)}</p>
                          {entry.note && <p className="mt-1 text-xs text-gray-500 italic">{entry.note}</p>}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <span className="font-mono text-lg font-black text-primary">+{entry.effectiveQuantity}</span>
                          <button type="button" onClick={() => onDeleteRestock(entry)} disabled={deleteRestock.isPending} className="inline-flex h-7 items-center gap-1 rounded-md border border-red-200 px-2 text-[10px] font-bold text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"><Trash2 className="h-3 w-3" /> Hapus</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2 mt-4">
                  {restockDisplayLimit > 5 && <button type="button" onClick={() => setRestockDisplayLimit(prev => Math.max(5, prev - 5))} className="flex-1 py-2 text-xs font-bold text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Lebih Sedikit</button>}
                  {restockDisplayLimit < visibleRestocks.length && <button type="button" onClick={() => setRestockDisplayLimit(prev => prev + 5)} className="flex-1 py-2 text-xs font-bold text-primary border border-primary/20 rounded-lg hover:bg-primary/5 transition-colors">Lebih Banyak</button>}
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
