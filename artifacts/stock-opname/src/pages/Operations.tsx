import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link } from "wouter";
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
import { ArrowLeft, Boxes, Camera, ClipboardCheck, PackagePlus, Plus, Trash2 } from "lucide-react";

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
  const { products } = useProducts();
  const [storeName, setStoreName] = useStoreName();
  const activeStore = storeName.trim();
  const [activeTab, setActiveTab] = useState<"visit" | "restock">("visit");
  const [scannerTarget, setScannerTarget] = useState<"visit" | "restock" | null>(null);
  const [visitProductSelection, setVisitProductSelection] = useState("");
  const [restockProductSelection, setRestockProductSelection] = useState("");
  const [lines, setLines] = useState<StocktakeLineInput[]>([]);
  const [restockSearch, setRestockSearch] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const visitClientId = useRef<string | null>(null);
  const restockClientId = useRef<string | null>(null);

  const storesQuery = useListStores({
    query: { queryKey: getListStoresQueryKey(), staleTime: 5 * 60 * 1000 },
  });
  const visitParams = { store: activeStore || undefined, limit: 25 };
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

  const productOptions = useMemo(() => {
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
    return [...byBarcode.values()].sort((a, b) => a.name.localeCompare(b.name, "id"));
  }, [products, restockHistoryQuery.data, visitHistoryQuery.data]);

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
    const knownProduct = productOptions.find((product) => product.barcode === barcode);
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

  const onAddLine = lineForm.handleSubmit((values) => {
    if (!activeStore) {
      toast({
        title: "Pilih toko terlebih dahulu",
        description: "Satu kunjungan hanya boleh berisi stok dari satu toko.",
        variant: "destructive",
      });
      return;
    }
    if (lines.some((line) => line.barcode === values.barcode.trim())) {
      lineForm.setError("barcode", { message: "Barcode ini sudah ditambahkan ke kunjungan." });
      return;
    }
    setLines((current) => [
      ...current,
      {
        product: values.product.trim(),
        barcode: values.barcode.trim(),
        displayQuantity: Number(values.displayQuantity || 0),
        secondaryDisplayQuantity: Number(values.secondaryDisplayQuantity || 0),
        warehouseQuantity: Number(values.warehouseQuantity || 0),
      },
    ]);
    setVisitProductSelection("");
    visitForm.clearErrors("root");
    lineForm.reset({
      barcode: "",
      product: "",
      displayQuantity: "",
      secondaryDisplayQuantity: "",
      warehouseQuantity: "",
    });
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
    if (lines.length === 0) {
      visitForm.setError("root", { message: "Tambahkan minimal satu SKU ke kunjungan ini." });
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
          setLines([]);
          setVisitProductSelection("");
          visitForm.reset({ visitedAt: localDateTime() });
          refreshAffectedData();
          toast({
            title: "Kunjungan tersimpan",
            description: `${visit.lines?.length ?? lines.length} SKU tersimpan untuk ${visit.store}. Penjualan dihitung setelah SKU memiliki kunjungan pembanding.`,
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
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Kunjungan mencatat jumlah fisik sebagai koreksi selisih di buku stok yang sama. Hitungan fisik tidak ditambahkan ulang sebagai stok baru.
            </p>
          </div>
          <Link href="/dashboard" className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-muted" data-testid="link-sales-dashboard">
            Penjualan harian
          </Link>
        </header>

        <section className="mb-5 grid gap-4 rounded-2xl border border-primary/15 bg-primary/[0.045] p-5 sm:grid-cols-[1fr_auto] sm:items-center" aria-label="Cara perhitungan saldo">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Satu saldo terpadu</p>
            <p className="mt-1 text-sm leading-6 text-foreground">
              Semua pergerakan tersimpan dalam satu ledger. Kunjungan menghasilkan selisih terhadap saldo buku; barang masuk menambah saldo dan penjualan menguranginya.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm sm:max-w-[300px]">
            <p className="font-semibold">Contoh</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Saldo buku 10, lalu hitungan fisik 12: ledger mencatat koreksi +2 dan saldo menjadi 12, bukan 22.
            </p>
          </div>
        </section>

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
          <p className="mt-2 text-xs text-muted-foreground">
            Catatan setiap toko tetap terpisah. Pilih atau ketik nama toko yang sama seperti kunjungan sebelumnya.
          </p>
        </section>

        <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-muted p-1" role="tablist" aria-label="Jenis pencatatan">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "visit"}
            onClick={() => setActiveTab("visit")}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${activeTab === "visit" ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="tab-stock-visit"
          >
            <ClipboardCheck className="h-4 w-4" /> Kunjungan SO
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "restock"}
            onClick={() => setActiveTab("restock")}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${activeTab === "restock" ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="tab-stock-restock"
          >
            <PackagePlus className="h-4 w-4" /> Barang masuk
          </button>
        </div>

        {activeTab === "visit" ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-serif text-xl font-bold">Catat satu kunjungan</h2>
              <p className="mb-5 mt-1 text-sm text-muted-foreground">Tambahkan seluruh SKU yang dihitung pada kunjungan ke toko ini.</p>

              <Form {...lineForm}>
                <form onSubmit={onAddLine} className="space-y-4 border-b border-border pb-5">
                  <div>
                    <label htmlFor="visit-product-select" className="mb-1.5 block text-sm font-medium">Pilih produk tersimpan (tanpa scan)</label>
                    <select
                      id="visit-product-select"
                      value={visitProductSelection}
                      onChange={(event) => {
                        const product = productOptions.find((item) => item.barcode === event.target.value);
                        setVisitProductSelection(product?.barcode ?? "");
                        if (product) {
                          lineForm.setValue("barcode", product.barcode, { shouldDirty: true, shouldValidate: true });
                          lineForm.setValue("product", product.name, { shouldDirty: true, shouldValidate: true });
                        }
                      }}
                      disabled={productOptions.length === 0}
                      className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60"
                      data-testid="select-visit-product"
                    >
                      <option value="">Pilih produk dari daftar</option>
                      {productOptions.map((product) => (
                        <option key={product.barcode} value={product.barcode}>{product.name} · {product.barcode}</option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Atau isi nama dan barcode/kode produk secara manual di bawah. Pemindai hanya pilihan.
                    </p>
                  </div>
                  <FormField
                    control={lineForm.control}
                    name="barcode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Barcode / kode produk</FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <input
                              {...field}
                              list="visit-product-barcodes"
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.preventDefault();
                              }}
                              onChange={(event) => {
                                field.onChange(event);
                                const match = productOptions.find((product) => product.barcode === event.target.value.trim());
                                setVisitProductSelection(match?.barcode ?? "");
                                lineForm.setValue("product", match?.name ?? "", { shouldDirty: true, shouldValidate: false });
                              }}
                              placeholder="Masukkan kode atau scan"
                              className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
                              data-testid="input-visit-barcode"
                            />
                            <button
                              type="button"
                              onClick={() => setScannerTarget("visit")}
                              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
                              aria-label="Scan barcode kunjungan"
                              data-testid="button-scan-visit-barcode"
                            >
                              <Camera className="h-4 w-4" /> Scan
                            </button>
                          </div>
                        </FormControl>
                        <datalist id="visit-product-barcodes">
                          {productOptions.map((product) => <option key={product.barcode} value={product.barcode} label={product.name} />)}
                        </datalist>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={lineForm.control}
                    name="product"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nama produk</FormLabel>
                        <FormControl>
                          <input
                            {...field}
                            onChange={(event) => {
                              setVisitProductSelection("");
                              field.onChange(event);
                            }}
                            placeholder="Nama produk"
                            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
                            data-testid="input-visit-product-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-3 gap-3">
                    {([
                      ["displayQuantity", "Display"],
                      ["secondaryDisplayQuantity", "Secondary"],
                      ["warehouseQuantity", "Gudang"],
                    ] as const).map(([name, label]) => (
                      <FormField
                        key={name}
                        control={lineForm.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{label}</FormLabel>
                            <FormControl>
                              <input
                                {...field}
                                type="number"
                                min="0"
                                step="1"
                                inputMode="numeric"
                                placeholder="0"
                                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-center text-base font-semibold"
                                data-testid={`input-visit-${name}`}
                              />
                            </FormControl>
                            {name === "displayQuantity" && <FormMessage />}
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-lg bg-secondary px-4 text-sm font-semibold text-secondary-foreground hover:opacity-90" data-testid="button-add-visit-line">
                    <Plus className="h-4 w-4" /> Tambahkan SKU
                  </button>
                </form>
              </Form>

              {productOptions.length === 0 && (
                <p className="mt-4 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground" data-testid="status-no-products">
                  Belum ada produk tersimpan. Masukkan nama dan barcode/kode produk sendiri; tidak perlu scan.
                </p>
              )}

              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">SKU dalam kunjungan</h3>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold" data-testid="text-visit-line-count">{lines.length} SKU</span>
                </div>
                {lines.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-7 text-center text-sm text-muted-foreground" data-testid="status-visit-lines-empty">
                    Belum ada SKU ditambahkan.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {lines.map((line) => {
                      const total = line.displayQuantity + line.secondaryDisplayQuantity + line.warehouseQuantity;
                      return (
                        <li key={line.barcode} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3" data-testid={`row-visit-line-${line.barcode}`}>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{line.product}</p>
                            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{line.barcode} · Display {line.displayQuantity} · Secondary {line.secondaryDisplayQuantity} · Gudang {line.warehouseQuantity}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="font-mono text-lg font-bold">{total}</span>
                            <button
                              type="button"
                              onClick={() => setLines((current) => current.filter((item) => item.barcode !== line.barcode))}
                              className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`Hapus ${line.product}`}
                              data-testid={`button-remove-visit-line-${line.barcode}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <Form {...visitForm}>
                <form onSubmit={onSaveVisit} className="mt-5 border-t border-border pt-5">
                  <FormField
                    control={visitForm.control}
                    name="visitedAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Waktu kunjungan</FormLabel>
                        <FormControl>
                          <input {...field} type="datetime-local" className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-visit-time" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {visitForm.formState.errors.root?.message && (
                    <p className="mt-2 text-sm text-destructive" role="alert" data-testid="status-visit-form-error">{visitForm.formState.errors.root.message}</p>
                  )}
                  <button
                    type="submit"
                    disabled={createVisit.isPending || lines.length === 0 || !activeStore}
                    className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="button-save-visit"
                  >
                    <ClipboardCheck className="h-4 w-4" />
                    {createVisit.isPending ? "Menyimpan kunjungan..." : "Simpan kunjungan SO"}
                  </button>
                </form>
              </Form>
            </section>

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
                <ul className="space-y-3">
                  {(visitHistoryQuery.data ?? []).slice(0, 10).map((visit) => (
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
                        const product = productOptions.find((item) => item.barcode === event.target.value);
                        setRestockProductSelection(product?.barcode ?? "");
                        if (product) {
                          restockForm.setValue("barcode", product.barcode, { shouldDirty: true, shouldValidate: true });
                          restockForm.setValue("product", product.name, { shouldDirty: true, shouldValidate: true });
                        }
                      }}
                      disabled={productOptions.length === 0}
                      className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60"
                      data-testid="select-restock-product"
                    >
                      <option value="">Pilih produk dari daftar</option>
                      {productOptions.map((product) => (
                        <option key={product.barcode} value={product.barcode}>{product.name} · {product.barcode}</option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Atau isi nama dan barcode/kode produk secara manual di bawah. Pemindai hanya pilihan.
                    </p>
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
                                const match = productOptions.find((product) => product.barcode === event.target.value.trim());
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
                              aria-label="Scan barcode barang masuk"
                              data-testid="button-scan-restock-barcode"
                            >
                              <Camera className="h-4 w-4" /> Scan
                            </button>
                          </div>
                        </FormControl>
                        <datalist id="restock-product-barcodes">
                          {productOptions.map((product) => <option key={product.barcode} value={product.barcode} label={product.name} />)}
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
                  {productOptions.length === 0 && (
                    <p className="-mt-2 text-xs text-muted-foreground">
                      Belum ada produk tersimpan. Masukkan nama dan barcode/kode produk sendiri; tidak perlu scan.
                    </p>
                  )}
                  <FormField
                    control={restockForm.control}
                    name="quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Jumlah diterima</FormLabel>
                        <FormControl>
                          <input {...field} type="number" min="1" step="1" inputMode="numeric" placeholder="Contoh: 12" className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-restock-quantity" />
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
                          <input {...field} type="datetime-local" className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" data-testid="input-restock-time" />
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
                          <textarea {...field} rows={3} maxLength={500} placeholder="Contoh: pengiriman pagi" className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm" data-testid="input-restock-note" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <button
                    type="submit"
                    disabled={createRestock.isPending || !activeStore}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="button-save-restock"
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
                  onChange={(event) => setRestockSearch(event.target.value)}
                  placeholder="Cari produk, barcode, atau toko"
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  data-testid="input-search-restocks"
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
                <div className="rounded-xl border border-dashed border-border px-4 py-7 text-center text-sm text-muted-foreground" data-testid="status-restocks-empty">
                  {(restockHistoryQuery.data ?? []).length === 0
                    ? "Belum ada barang masuk tersimpan."
                    : "Tidak ada barang masuk yang cocok dengan pencarian."}
                </div>
              ) : (
                <>
                <ul className="max-h-[44rem] space-y-3 overflow-y-auto pr-1">
                  {visibleRestocks.map((entry) => {
                    return (
                    <li key={entry.id} className="rounded-xl border border-border p-3" data-testid={`row-restock-history-${entry.id}`}>
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
                              data-testid={`button-delete-restock-${entry.id}`}
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
                <p className="mt-3 text-xs text-muted-foreground" data-testid="text-restock-history-count">
                  {visibleRestocks.length} dari {(restockHistoryQuery.data ?? []).length} catatan barang masuk ditampilkan
                  {(restockHistoryQuery.data ?? []).length === 500 ? " · menampilkan 500 catatan terbaru" : ""}
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
