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
import { ArrowLeft, Boxes, Camera, ClipboardCheck, PackagePlus, Plus, Trash2, Search } from "lucide-react";

const integerText = z
  .string()
  .refine((value) => value === "" || /^\d+$/.test(value), "Masukkan bilangan bulat nol atau lebih.");

const lineFormSchema = z
  .object({
    barcode: z.string().trim().min(1, "Masukkan kode produk atau pilih produk tersimpan."),
    product: z.string().trim().min(1, "Nama produk wajib diisi."),
    displayQuantity: integerText,
    secondaryDisplayQuantity: integerText,
    warehouseQuantity: integerText,
  })
  .superRefine((line, context) => {
    if (
      line.displayQuantity === "" &&
      line.secondaryDisplayQuantity === "" &&
      line.warehouseQuantity === ""
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["displayQuantity"],
        message: "Isi minimal satu jumlah, termasuk 0 bila stok memang kosong.",
      });
    }
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

type LineFormValues = z.infer<typeof lineFormSchema>;
type VisitFormValues = z.infer<typeof visitFormSchema>;
type RestockFormValues = z.infer<typeof restockFormSchema>;

type DraftQty = { display: string; secondary: string; warehouse: string };

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Operations() {
  const [, setLocation] = useLocation();

  const { products } = useProducts();
  const [storeName, setStoreName] = useStoreName();
  const activeStore = storeName.trim();
  const [activeTab, setActiveTab] = useState<"visit" | "restock">("visit");
  const [scannerTarget, setScannerTarget] = useState<"visit" | "restock" | null>(null);
  const [visitProductSelection, setVisitProductSelection] = useState("");
  const [restockProductSelection, setRestockProductSelection] = useState("");
  
  // State for direct table input
  const [draftQuantities, setDraftQuantities] = useState<Record<string, DraftQty>>({});
  const [visitSearch, setVisitSearch] = useState("");
  const [showNewProductForm, setShowNewProductForm] = useState(false);
  const [customProducts, setCustomProducts] = useState<{barcode: string, name: string}[]>([]);

  const [restockSearch, setRestockSearch] = useState("");
  
  // STATE UNTUK PAGINATION
  const [visitDisplayLimit, setVisitDisplayLimit] = useState(5);
  const [restockDisplayLimit, setRestockDisplayLimit] = useState(5);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const visitClientId = useRef<string | null>(null);
  const restockClientId = useRef<string | null>(null);

  const storesQuery = useListStores({
    query: { queryKey: getListStoresQueryKey(), staleTime: 5 * 60 * 1000 },
  });
  
  const visitParams = { store: activeStore || undefined, limit: 50 }; 
  const visitHistoryQuery = useListStockVisits(visitParams, {
    query: {
      queryKey: getListStockVisitsQueryKey(visitParams),
      enabled: true,
      staleTime: 0,
      refetchOnMount: "always",
    },
  });
  
  const restockParams = { store: activeStore || undefined, limit: 500 };
  const restockHistoryQuery = useListStockRestocks(restockParams, {
    query: {
      queryKey: getListStockRestocksQueryKey(restockParams),
      enabled: true,
      staleTime: 0,
      refetchOnMount: "always",
    },
  });

  // Gabungkan produk dari DB, riwayat, dan input manual baru
  const allProductOptions = useMemo(() => {
    const byBarcode = new Map<string, { barcode: string; name: string }>();
    for (const visit of visitHistoryQuery.data ?? []) {
      for (const line of visit.lines ?? []) {
        if (!byBarcode.has(line.barcode)) {
          byBarcode.set(line.barcode, { barcode: line.barcode, name: line.product });
        }
      }
    }
    for (const entry of restockHistoryQuery.data ?? []) {
      if (!byBarcode.has(entry.barcode)) {
        byBarcode.set(entry.barcode, { barcode: entry.barcode, name: entry.product });
      }
    }
    for (const product of products) {
      byBarcode.set(product.barcode, { barcode: product.barcode, name: product.name });
    }
    for (const cp of customProducts) {
      byBarcode.set(cp.barcode, cp);
    }
    return [...byBarcode.values()].sort((a, b) => a.name.localeCompare(b.name, "id"));
  }, [products, restockHistoryQuery.data, visitHistoryQuery.data, customProducts]);

  const filteredVisitProducts = useMemo(() => {
    const q = visitSearch.toLowerCase();
    return allProductOptions.filter(p => p.name.toLowerCase().includes(q) || p.barcode.includes(q));
  }, [allProductOptions, visitSearch]);

  const visibleRestocks = useMemo(() => {
    const query = restockSearch.trim().toLocaleLowerCase("id-ID");
    const rows = restockHistoryQuery.data ?? [];
    if (!query) return rows;
    return rows.filter((entry) =>
      [entry.product, entry.barcode, entry.store]
        .some((value) => value.toLocaleLowerCase("id-ID").includes(query)),
    );
  }, [restockHistoryQuery.data, restockSearch]);

  const lineForm = useForm<LineFormValues>({
    resolver: zodResolver(lineFormSchema),
    defaultValues: {
      barcode: "",
      product: "",
      displayQuantity: "",
      secondaryDisplayQuantity: "",
      warehouseQuantity: "",
    },
  });
  
  const visitForm = useForm<VisitFormValues>({
    resolver: zodResolver(visitFormSchema),
    defaultValues: { visitedAt: localDateTime() },
  });

  const restockForm = useForm<RestockFormValues>({
    resolver: zodResolver(restockFormSchema),
    defaultValues: { barcode: "", product: "", quantity: "", receivedAt: localDateTime(), note: "" },
  });

  const setScannedBarcode = (target: "visit" | "restock", scannedValue: string) => {
    const barcode = scannedValue.trim();
    const knownProduct = allProductOptions.find((product) => product.barcode === barcode);
    if (target === "visit") {
      setVisitProductSelection(knownProduct?.barcode ?? "");
      lineForm.setValue("barcode", barcode, { shouldDirty: true, shouldValidate: true });
      lineForm.setValue("product", knownProduct?.name ?? "", { shouldDirty: true, shouldValidate: true });
    } else {
      setRestockProductSelection(knownProduct?.barcode ?? "");
      restockForm.setValue("barcode", barcode, { shouldDirty: true, shouldValidate: true });
      restockForm.setValue("product", knownProduct?.name ?? "", { shouldDirty: true, shouldValidate: true });
    }
    return knownProduct;
  };

  const handleScanSuccess = (code: string) => {
    if (!scannerTarget) return;
    const product = setScannedBarcode(scannerTarget, code);
    setScannerTarget(null);
    toast({
      title: product ? "Barcode ditemukan" : "Barcode berhasil dibaca",
      description: product
        ? `Produk: ${product.name}`
        : `${code}. Isi nama produk untuk melanjutkan.`,
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

  // Fungsi untuk update angka langsung dari tabel
  const handleDraftChange = (barcode: string, field: keyof DraftQty, value: string) => {
    if (value !== "" && !/^\d+$/.test(value)) return; // cuma boleh angka
    setDraftQuantities(prev => {
      const existing = prev[barcode] || { display: "", secondary: "", warehouse: "" };
      return { ...prev, [barcode]: { ...existing, [field]: value } };
    });
  };

  // Fungsi tambah produk baru via form manual
  const onAddNewProduct = lineForm.handleSubmit((values) => {
    const barcode = values.barcode.trim();
    const productName = values.product.trim();
    
    // Tambah ke list custom
    if (!allProductOptions.some(p => p.barcode === barcode)) {
      setCustomProducts(prev => [...prev, { barcode, name: productName }]);
    }
    
    // Langsung isi draft quantity-nya
    setDraftQuantities(prev => ({
      ...prev,
      [barcode]: {
        display: values.displayQuantity,
        secondary: values.secondaryDisplayQuantity,
        warehouse: values.warehouseQuantity,
      }
    }));

    setVisitProductSelection("");
    lineForm.reset();
    setShowNewProductForm(false); // Sembunyikan form lagi
    toast({ title: "Produk ditambahkan", description: `${productName} siap diisi angkanya.` });
  });

  const createVisit = useCreateStockVisit();
  const createRestock = useCreateStockRestock();
  const deleteVisit = useDeleteStockVisit();
  const deleteRestock = useDeleteStockRestock();

  const onSaveVisit = visitForm.handleSubmit((values) => {
    if (!activeStore) {
      toast({
        title: "Nama toko wajib diisi",
        description: "Masukkan nama toko sebelum menyimpan kunjungan.",
        variant: "destructive",
      });
      return;
    }

    // Convert draftQuantities ke format lines
    const lines: StocktakeLineInput[] = [];
    for (const [barcode, qty] of Object.entries(draftQuantities)) {
      if (qty.display === "" && qty.secondary === "" && qty.warehouse === "") continue;
      const product = allProductOptions.find(p => p.barcode === barcode);
      if (product) {
        lines.push({
          barcode,
          product: product.name,
          displayQuantity: Number(qty.display || 0),
          secondaryDisplayQuantity: Number(qty.secondary || 0),
          warehouseQuantity: Number(qty.warehouse || 0),
        });
      }
    }

    if (lines.length === 0) {
      visitForm.setError("root", { message: "Isi minimal satu angka pada daftar produk." });
      return;
    }

    visitClientId.current ??= crypto.randomUUID();
    createVisit.mutate(
      {
        data: {
          clientId: visitClientId.current,
          store: activeStore,
          visitedAt: new Date(values.visitedAt).toISOString(),
          lines,
        },
      },
      {
        onSuccess: (visit) => {
          visitClientId.current = null;
          setDraftQuantities({}); // Reset tabel
          visitForm.reset({ visitedAt: localDateTime() });
          refreshAffectedData();
          toast({
            title: "Kunjungan tersimpan",
            description: `${visit.lines?.length ?? lines.length} SKU tersimpan untuk ${visit.store}.`,
          });
        },
        onError: (error) => {
          toast({
            title: "Kunjungan belum tersimpan",
            description: error.message || "Periksa koneksi lalu coba lagi.",
            variant: "destructive",
          });
        },
      },
    );
  });

  const onSaveRestock = restockForm.handleSubmit((values) => {
    if (!activeStore) {
      toast({
        title: "Nama toko wajib diisi",
        description: "Masukkan nama toko sebelum mencatat barang masuk.",
        variant: "destructive",
      });
      return;
    }
    restockClientId.current ??= crypto.randomUUID();
    createRestock.mutate(
      {
        data: {
          clientId: restockClientId.current,
          store: activeStore,
          product: values.product.trim(),
          barcode: values.barcode.trim(),
          quantity: Number(values.quantity),
          receivedAt: new Date(values.receivedAt).toISOString(),
          ...(values.note.trim() ? { note: values.note.trim() } : {}),
        },
      },
      {
        onSuccess: (entry) => {
          restockClientId.current = null;
          setRestockProductSelection("");
          restockForm.reset({ barcode: "", product: "", quantity: "", receivedAt: localDateTime(), note: "" });
          refreshAffectedData();
          toast({
            title: "Barang masuk tersimpan",
            description: `${entry.quantity} unit ${entry.product} dicatat untuk ${entry.store}.`,
          });
        },
        onError: (error) => {
          toast({
            title: "Barang masuk belum tersimpan",
            description: error.message || "Periksa koneksi lalu coba lagi.",
            variant: "destructive",
          });
        },
      },
    );
  });

  const onDeleteVisit = (id: number) => {
    if (!window.confirm("Hapus kunjungan stok ini? Perhitungan penjualan interval terkait akan diperbarui.")) return;
    deleteVisit.mutate({ id }, {
      onSuccess: () => {
        refreshAffectedData();
        toast({ title: "Kunjungan dihapus", description: "Saldo dan perhitungan penjualan diperbarui." });
      },
      onError: (error) => toast({ title: "Kunjungan belum dihapus", description: error.message || "Coba lagi.", variant: "destructive" }),
    });
  };

  const onDeleteRestock = (entry: StockRestock) => {
    if (!window.confirm(`Hapus penerimaan ${entry.quantity} unit ${entry.product}? Saldo dan laporan akan dihitung ulang.`)) return;
    deleteRestock.mutate({ id: entry.id }, {
      onSuccess: () => {
        refreshAffectedData();
        toast({ title: "Barang masuk dihapus", description: "Saldo dan perhitungan penjualan diperbarui." });
      },
      onError: (error) => toast({ title: "Barang masuk belum dihapus", description: error.message || "Coba lagi.", variant: "destructive" }),
    });
  };

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="link-back-stock">
              <ArrowLeft className="h-4 w-4" /> Input stok
            </Link>
            <h1 className="font-serif text-3xl font-bold tracking-tight">Kunjungan & barang masuk</h1>
          </div>
          
          <button
            type="button"
            onClick={() => setLocation("/dashboard")}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-muted transition-colors"
            data-testid="link-sales-dashboard"
          >
            Penjualan harian
          </button>
        </header>

        <section className="mb-5 rounded-2xl border border-border bg-card p-5">
          <label htmlFor="active-store" className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Boxes className="h-4 w-4 text-primary" /> Toko aktif
          </label>
          <input
            id="active-store"
            list="known-stores"
            value={storeName}
            onChange={(event) => setStoreName(event.target.value)}
            placeholder="Contoh: Toko Sentosa"
            required
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            data-testid="input-active-store"
          />
          <datalist id="known-stores">
            {(storesQuery.data ?? []).map((store) => <option key={store.name} value={store.name} />)}
          </datalist>
        </section>

        <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-muted p-1" role="tablist" aria-label="Jenis pencatatan">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "visit"}
            onClick={() => setActiveTab("visit")}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${activeTab === "visit" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="tab-stock-visit"
          >
            <ClipboardCheck className="h-4 w-4" /> Kunjungan SO
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "restock"}
            onClick={() => setActiveTab("restock")}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${activeTab === "restock" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="tab-stock-restock"
          >
            <PackagePlus className="h-4 w-4" /> Barang masuk
          </button>
        </div>

        {activeTab === "visit" ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
            <section className="rounded-2xl border border-border bg-card p-5">
              
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-xl font-bold">Hitung Fisik</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Isi angka langsung di tabel. Kosongkan jika 0.</p>
                </div>
                <button 
                  type="button"
                  onClick={() => setShowNewProductForm(!showNewProductForm)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 text-xs font-semibold text-primary"
                >
                  <Plus className="h-4 w-4" /> Produk Baru
                </button>
              </div>

              {/* FORM PRODUK BARU (Sembunyi default) */}
              {showNewProductForm && (
                <div className="mb-5 rounded-xl border border-border bg-muted/30 p-4">
                  <Form {...lineForm}>
                    <form onSubmit={onAddNewProduct} className="space-y-3">
                       <FormField control={lineForm.control} name="barcode" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Barcode / Kode</FormLabel>
                            <FormControl>
                              <div className="flex gap-2">
                                <input {...field} placeholder="Scan / ketik kode" className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm" />
                                <button type="button" onClick={() => setScannerTarget("visit")} className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-semibold">
                                  <Camera className="h-3.5 w-3.5" /> Scan
                                </button>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={lineForm.control} name="product" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Nama Produk</FormLabel>
                            <FormControl>
                              <input {...field} placeholder="Nama Produk" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="grid grid-cols-3 gap-2">
                          {(["displayQuantity", "secondaryDisplayQuantity", "warehouseQuantity"] as const).map((name, i) => (
                            <FormField key={name} control={lineForm.control} name={name} render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-[10px] uppercase">{["Display", "Secondary", "Gudang"][i]}</FormLabel>
                                <FormControl>
                                  <input {...field} type="number" inputMode="numeric" placeholder="0" className="h-9 w-full rounded-md border border-input bg-background text-center text-sm font-semibold" />
                                </FormControl>
                              </FormItem>
                            )} />
                          ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button type="submit" className="flex-1 rounded-md bg-primary py-1.5 text-xs font-semibold text-primary-foreground">Tambahkan</button>
                          <button type="button" onClick={() => setShowNewProductForm(false)} className="flex-1 rounded-md border border-border bg-card py-1.5 text-xs font-semibold">Batal</button>
                        </div>
                    </form>
                  </Form>
                </div>
              )}

              {/* SEARCH BAR */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input 
                  type="search" 
                  placeholder="Cari produk..." 
                  value={visitSearch}
                  onChange={e => setVisitSearch(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm" 
                />
              </div>

              {/* LIST TABLE */}
              <div className="mb-5 max-h-[50vh] overflow-y-auto rounded-xl border border-border">
                {filteredVisitProducts.length === 0 ? (
                  <div className="p-5 text-center text-sm text-muted-foreground">Produk tidak ditemukan.</div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredVisitProducts.map((p) => {
                      const qty = draftQuantities[p.barcode] || { display: "", secondary: "", warehouse: "" };
                      return (
                        <div key={p.barcode} className="flex flex-col gap-2 p-3 hover:bg-muted/30">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold">{p.name}</span>
                            <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{p.barcode}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Display</label>
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder="0"
                                value={qty.display}
                                onChange={(e) => handleDraftChange(p.barcode, 'display', e.target.value)}
                                className="h-10 w-full rounded-md border border-input bg-background text-center text-sm font-bold focus:border-primary focus:ring-1 focus:ring-primary"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Secondary</label>
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder="0"
                                value={qty.secondary}
                                onChange={(e) => handleDraftChange(p.barcode, 'secondary', e.target.value)}
                                className="h-10 w-full rounded-md border border-input bg-background text-center text-sm font-bold focus:border-primary focus:ring-1 focus:ring-primary"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Gudang</label>
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder="0"
                                value={qty.warehouse}
                                onChange={(e) => handleDraftChange(p.barcode, 'warehouse', e.target.value)}
                                className="h-10 w-full rounded-md border border-input bg-background text-center text-sm font-bold focus:border-primary focus:ring-1 focus:ring-primary"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <Form {...visitForm}>
                <form onSubmit={onSaveVisit} className="border-t border-border pt-4">
                  <FormField
                    control={visitForm.control}
                    name="visitedAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Waktu kunjungan</FormLabel>
                        <FormControl>
                          <input {...field} type="datetime-local" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {visitForm.formState.errors.root?.message && (
                    <p className="mt-2 text-sm text-destructive font-semibold" role="alert">{visitForm.formState.errors.root.message}</p>
                  )}
                  <button
                    type="submit"
                    disabled={createVisit.isPending}
                    className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    <ClipboardCheck className="h-5 w-5" />
                    {createVisit.isPending ? "Menyimpan..." : "Simpan Kunjungan SO"}
                  </button>
                </form>
              </Form>
            </section>

            {/* RIWAYAT KUNJUNGAN */}
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-serif text-xl font-bold">Kunjungan terakhir</h2>
              <p className="mb-4 mt-1 text-sm text-muted-foreground">
                {activeStore ? `Riwayat ${activeStore}` : "Pilih toko untuk membatasi daftar ini."}
              </p>
              {visitHistoryQuery.isLoading ? (
                <div className="space-y-3 py-3" aria-label="Memuat kunjungan">
                  <div className="h-16 animate-pulse rounded-xl bg-muted" />
                  <div className="h-16 animate-pulse rounded-xl bg-muted" />
                </div>
              ) : visitHistoryQuery.isError ? (
                <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-6 text-center" role="alert">
                  <p className="text-sm font-semibold">Riwayat kunjungan tidak dapat dimuat</p>
                  <button type="button" onClick={() => visitHistoryQuery.refetch()} className="mt-2 text-xs font-semibold text-primary underline underline-offset-2">Coba lagi</button>
                </div>
              ) : (visitHistoryQuery.data ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-7 text-center text-sm text-muted-foreground" data-testid="status-visits-empty">
                  Belum ada kunjungan SO tersimpan untuk toko ini.
                </div>
              ) : (
                <>
                  <ul className="space-y-3">
                    {(visitHistoryQuery.data ?? []).slice(0, visitDisplayLimit).map((visit) => (
                      <li key={visit.id} className="rounded-xl border border-border p-3" data-testid={`row-visit-history-${visit.id}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{visit.store}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{formatDate(visit.visitedAt)}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{visit.lines?.length ?? 0} SKU</span>
                            <button type="button" onClick={() => onDeleteVisit(visit.id)} disabled={deleteVisit.isPending} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" aria-label={`Hapus kunjungan ${formatDate(visit.visitedAt)}`} data-testid={`button-delete-visit-${visit.id}`}><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  
                  <div className="flex gap-2 mt-4">
                    {visitDisplayLimit > 5 && (
                      <button type="button" onClick={() => setVisitDisplayLimit(prev => Math.max(5, prev - 5))} className="flex-1 py-2 text-sm font-semibold text-muted-foreground border border-border rounded-xl hover:bg-muted/50">Muat Lebih Sedikit</button>
                    )}
                    {visitDisplayLimit < (visitHistoryQuery.data ?? []).length && (
                      <button type="button" onClick={() => setVisitDisplayLimit(prev => prev + 5)} className="flex-1 py-2 text-sm font-semibold text-primary border border-primary/30 rounded-xl hover:bg-primary/5">Muat Lebih Banyak</button>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1fr]">
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-serif text-xl font-bold">Catat barang masuk</h2>
              <p className="mb-5 mt-1 text-sm text-muted-foreground">
                Gunakan waktu barang benar-benar diterima. Jika waktunya sama dengan kunjungan SO, urutan transaksi tersimpan menentukan apakah barang sudah tercakup dalam hitungan fisik.
              </p>
              <Form {...restockForm}>
                <form onSubmit={onSaveRestock} className="space-y-4">
                  <div>
                    <label htmlFor="restock-product-select" className="mb-1.5 block text-sm font-medium">Pilih produk tersimpan (tanpa scan)</label>
                    <select
                      id="restock-product-select"
                      value={restockProductSelection}
                      onChange={(event) => {
                        const product = allProductOptions.find((item) => item.barcode === event.target.value);
                        setRestockProductSelection(product?.barcode ?? "");
                        if (product) {
                          restockForm.setValue("barcode", product.barcode, { shouldDirty: true, shouldValidate: true });
                          restockForm.setValue("product", product.name, { shouldDirty: true, shouldValidate: true });
                        }
                      }}
                      disabled={allProductOptions.length === 0}
                      className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60"
                      data-testid="select-restock-product"
                    >
                      <option value="">Pilih produk dari daftar</option>
                      {allProductOptions.map((product) => (
                        <option key={product.barcode} value={product.barcode}>{product.name} · {product.barcode}</option>
                      ))}
                    </select>
                  </div>
                  <FormField
                    control={restockForm.control}
                    name="barcode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Barcode / kode produk</FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <input
                              {...field}
                              list="restock-product-barcodes"
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.preventDefault();
                              }}
                              onChange={(event) => {
                                field.onChange(event);
                                const match = allProductOptions.find((product) => product.barcode === event.target.value.trim());
                                setRestockProductSelection(match?.barcode ?? "");
                                restockForm.setValue("product", match?.name ?? "", { shouldDirty: true, shouldValidate: false });
                              }}
                              placeholder="Masukkan kode atau scan"
                              className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
                              data-testid="input-restock-barcode"
                            />
                            <button
                              type="button"
                              onClick={() => setScannerTarget("restock")}
                              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
                            >
                              <Camera className="h-4 w-4" /> Scan
                            </button>
                          </div>
                        </FormControl>
                        <datalist id="restock-product-barcodes">
                          {allProductOptions.map((product) => <option key={product.barcode} value={product.barcode} label={product.name} />)}
                        </datalist>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={restockForm.control}
                    name="product"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nama produk</FormLabel>
                        <FormControl>
                          <input
                            {...field}
                            onChange={(event) => {
                              setRestockProductSelection("");
                              field.onChange(event);
                            }}
                            placeholder="Nama produk"
                            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
                            data-testid="input-restock-product-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={restockForm.control}
                    name="quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Jumlah diterima</FormLabel>
                        <FormControl>
                          <input {...field} type="number" min="1" step="1" inputMode="numeric" placeholder="Contoh: 12" className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={restockForm.control}
                    name="receivedAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Waktu diterima</FormLabel>
                        <FormControl>
                          <input {...field} type="datetime-local" className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={restockForm.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Catatan (opsional)</FormLabel>
                        <FormControl>
                          <textarea {...field} rows={3} maxLength={500} placeholder="Contoh: pengiriman pagi" className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <button
                    type="submit"
                    disabled={createRestock.isPending || !activeStore}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PackagePlus className="h-4 w-4" />
                    {createRestock.isPending ? "Menyimpan barang masuk..." : "Simpan barang masuk"}
                  </button>
                </form>
              </Form>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-serif text-xl font-bold">Barang masuk terakhir</h2>
              <p className="mb-4 mt-1 text-sm text-muted-foreground">
                {activeStore ? `Riwayat ${activeStore}` : "Semua toko."}
              </p>
              <label className="mb-4 block">
                <span className="sr-only">Cari barang masuk</span>
                <input
                  type="search"
                  value={restockSearch}
                  onChange={(event) => {
                    setRestockSearch(event.target.value);
                    setRestockDisplayLimit(5); 
                  }}
                  placeholder="Cari produk, barcode, atau toko"
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                />
              </label>
              {restockHistoryQuery.isLoading ? (
                <div className="space-y-3 py-3" aria-label="Memuat barang masuk">
                  <div className="h-16 animate-pulse rounded-xl bg-muted" />
                  <div className="h-16 animate-pulse rounded-xl bg-muted" />
                </div>
              ) : restockHistoryQuery.isError ? (
                <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-6 text-center" role="alert">
                  <p className="text-sm font-semibold">Riwayat barang masuk tidak dapat dimuat</p>
                  <button type="button" onClick={() => restockHistoryQuery.refetch()} className="mt-2 text-xs font-semibold text-primary underline underline-offset-2">Coba lagi</button>
                </div>
              ) : visibleRestocks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-7 text-center text-sm text-muted-foreground">
                  {(restockHistoryQuery.data ?? []).length === 0
                    ? "Belum ada barang masuk tersimpan."
                    : "Tidak ada barang masuk yang cocok dengan pencarian."}
                </div>
              ) : (
                <>
                <ul className="space-y-3">
                  {visibleRestocks.slice(0, restockDisplayLimit).map((entry) => {
                    return (
                    <li key={entry.id} className="rounded-xl border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{entry.product} <span className="font-mono text-xs font-normal text-muted-foreground">· {entry.barcode}</span></p>
                          <p className="mt-1 text-xs text-muted-foreground">{entry.store} · {formatDate(entry.receivedAt)}</p>
                          {entry.note && <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>}
                          <p className="mt-2 text-xs text-muted-foreground">
                            Diterima {entry.quantity} unit · jumlah efektif {entry.effectiveQuantity} unit
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <span className="font-mono text-lg font-bold">+{entry.effectiveQuantity}</span>
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => onDeleteRestock(entry)}
                              disabled={deleteRestock.isPending}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-destructive/30 px-2.5 text-xs font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Hapus
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                  })}
                </ul>

                <div className="flex gap-2 mt-4">
                  {restockDisplayLimit > 5 && (
                    <button type="button" onClick={() => setRestockDisplayLimit(prev => Math.max(5, prev - 5))} className="flex-1 py-2 text-sm font-semibold text-muted-foreground border border-border rounded-xl hover:bg-muted/50">Muat Lebih Sedikit</button>
                  )}
                  {restockDisplayLimit < visibleRestocks.length && (
                    <button type="button" onClick={() => setRestockDisplayLimit(prev => prev + 5)} className="flex-1 py-2 text-sm font-semibold text-primary border border-primary/30 rounded-xl hover:bg-primary/5">Muat Lebih Banyak</button>
                  )}
                </div>

                <p className="mt-3 text-xs text-muted-foreground text-center">
                  {visibleRestocks.length} catatan ditemukan
                </p>
                </>
              )}
            </section>
          </div>
        )}
      </div>
      <BarcodeScanner
        isOpen={scannerTarget !== null}
        onClose={() => setScannerTarget(null)}
        onScanSuccess={handleScanSuccess}
      />
    </main>
  );
}
