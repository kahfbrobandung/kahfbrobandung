import React, { useState, useMemo, useCallback } from 'react';
import { useProducts } from '@/hooks/useProducts';
import { useStoreName } from '@/hooks/useStoreName';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { ProductManager } from '@/components/ProductManager';
import { ThemeToggle } from '@/components/theme-toggle';
import { useToast } from '@/hooks/use-toast';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Cloud,
  Clock3,
  PackageSearch,
  QrCode,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getGetSalesActivityQueryKey,
  getGetSalesMonitorQueryKey,
  getListStockEntriesQueryKey,
  getListStockBalancesQueryKey,
  getListStoresQueryKey,
  useListStores,
  getHealthCheckQueryKey,
  useHealthCheck,
  useCreateStockEntry,
  useDeleteStockEntry,
  useListStockBalances,
  useListStockEntries,
  useRetryStockEntrySync,
  type StockBalance,
  type StockEntry,
} from '@workspace/api-client-react';

const TRANSACTIONS = [
  'Input Stok',
  'Stock Awal',
  'Penjualan',
  'Koreksi Stok +',
  'Koreksi Stok -',
  'Pembelian',
  'Retur',
  'Lainnya'
];

export default function Home() {
  const { products, addProduct, removeProduct, updateProduct, replaceProducts } = useProducts();
  const [storeName, setStoreName] = useStoreName();
  const { toast } = useToast();

  const [transaction, setTransaction] = useState(TRANSACTIONS[0]);
  const [selectedBarcode, setSelectedBarcode] = useState('');
  const [displayQuantity, setDisplayQuantity] = useState<number | ''>('');
  const [secondaryDisplayQuantity, setSecondaryDisplayQuantity] = useState<number | ''>('');
  const [warehouseQuantity, setWarehouseQuantity] = useState<number | ''>('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const queryClient = useQueryClient();
  const activeStore = storeName.trim();
  const totalStock = Number(displayQuantity || 0) + Number(secondaryDisplayQuantity || 0) + Number(warehouseQuantity || 0);
  const isNegativeMovement = transaction === 'Penjualan' || transaction === 'Koreksi Stok -';
  const isPhysicalCorrection = transaction === 'Koreksi Stok +' || transaction === 'Koreksi Stok -';
  const { data: health } = useHealthCheck({
    query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30_000 },
  });
  const storesQuery = useListStores({
    query: { queryKey: getListStoresQueryKey(), staleTime: 5 * 60 * 1000 },
  });

  const { data: recentEntries = [], isLoading: isRecentLoading, isError: entriesError, refetch: refetchEntries } = useListStockEntries(
    { store: activeStore, limit: 5 },
    {
      query: {
        queryKey: getListStockEntriesQueryKey({ store: activeStore, limit: 5 }),
        refetchInterval: 5000,
        enabled: Boolean(activeStore),
      },
    },
  );
  const { data: stockBalances = [], isLoading: isBalanceLoading, isError: balancesError, refetch: refetchBalances } = useListStockBalances(
    { store: activeStore },
    {
      query: {
        queryKey: getListStockBalancesQueryKey({ store: activeStore }),
        refetchInterval: 5000,
        enabled: Boolean(activeStore),
      },
    },
  );

  const retryMutation = useRetryStockEntrySync({
    mutation: {
      onSuccess: (entry) => {
        queryClient.invalidateQueries({ queryKey: getListStockEntriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListStockBalancesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSalesMonitorQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSalesActivityQueryKey() });
        toast({
          title: entry.syncStatus === 'synced' ? 'Berhasil Sinkron' : 'Belum Tersinkron',
          description:
            entry.syncStatus === 'synced'
              ? 'Data berhasil dikirim ulang ke Google Sheets.'
              : 'Server tetap menyimpan data, tetapi spreadsheet belum menerima data.',
          variant: entry.syncStatus === 'synced' ? 'default' : 'destructive',
        });
      },
      onError: (err: any) => {
        toast({
          title: 'Gagal Sinkron',
          description: err.message || 'Data tetap aman di server dan dapat dicoba lagi.',
          variant: 'destructive',
        });
      },
    },
  });

  const deleteEntryMutation = useDeleteStockEntry();
  const deleteEntry = (entry: StockEntry) => {
    if (!window.confirm(`Hapus catatan ${entry.transaction} ${entry.product} (${entry.quantity} unit)? Saldo akan dihitung ulang.`)) return;
    deleteEntryMutation.mutate({ id: entry.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListStockEntriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListStockBalancesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSalesMonitorQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSalesActivityQueryKey() });
        toast({ title: 'Catatan dihapus', description: 'Saldo toko dan laporan penjualan diperbarui.' });
      },
      onError: (err: any) => toast({
        title: 'Catatan belum dihapus',
        description: err.message || 'Silakan coba lagi.',
        variant: 'destructive',
      }),
    });
  };

  const submitMutation = useCreateStockEntry({
    mutation: {
      onSuccess: (entry) => {
        queryClient.invalidateQueries({ queryKey: getListStockEntriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListStockBalancesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSalesMonitorQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSalesActivityQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
        if (entry.syncStatus === 'synced') {
          toast({
            title: 'Tersimpan & Tersinkron',
            description: 'Data sudah tersimpan di server dan Google Sheets.',
          });
        } else {
          toast({
            title: 'Tersimpan di Server',
            description: 'Spreadsheet belum menerima data. Anda bisa mencoba sinkron ulang dari daftar transaksi.',
            variant: 'destructive',
          });
        }
        setDisplayQuantity('');
        setSecondaryDisplayQuantity('');
        setWarehouseQuantity('');
      },
      onError: (err: any) => {
      toast({
        title: 'Gagal Menyimpan ke Server',
        description: err.message || 'Data belum tersimpan. Silakan coba lagi.',
        variant: 'destructive',
      });
      },
    },
  });

  const getPayload = () => {
    const product = products.find(p => p.barcode === selectedBarcode);
    return {
      clientId: globalThis.crypto.randomUUID(),
      store: activeStore,
      transaction,
      product: product ? product.name : '',
      quantity: totalStock,
      barcode: selectedBarcode,
      displayQuantity: Number(displayQuantity || 0),
      secondaryDisplayQuantity: Number(secondaryDisplayQuantity || 0),
      warehouseQuantity: Number(warehouseQuantity || 0),
    };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const hasQuantity = displayQuantity !== '' || secondaryDisplayQuantity !== '' || warehouseQuantity !== '';
    if (!activeStore || !transaction || !selectedBarcode || !hasQuantity) {
      toast({
        title: 'Peringatan',
        description: 'Pilih toko dan produk, lalu masukkan jumlah pergerakan pada Display, Secondary, atau Gudang.',
        variant: 'destructive'
      });
      return;
    }
    submitMutation.mutate({ data: getPayload() });
  };

  const handleScanSuccess = useCallback((code: string) => {
    setIsScannerOpen(false);
    const product = products.find(p => p.barcode === code);
    if (product) {
      setSelectedBarcode(product.barcode);
      toast({
        title: 'Barcode Ditemukan',
        description: `Produk: ${product.name}`,
      });
    } else {
      toast({
        title: 'Barcode Tidak Dikenali',
        description: `${code}. Silakan pilih manual atau tambahkan produk baru.`,
        variant: 'destructive'
      });
      setSelectedBarcode('');
    }
  }, [products, toast]);

  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category));
    return Array.from(cats).sort();
  }, [products]);
  const selectedBalance = useMemo<StockBalance | undefined>(
    () => stockBalances.find((balance) => balance.barcode === selectedBarcode),
    [selectedBarcode, stockBalances],
  );

  const getSyncMeta = (entry: StockEntry) => {
    if (entry.syncStatus === 'synced') {
      return {
        label: 'Tersinkron',
        icon: CheckCircle2,
        className: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      };
    }
    if (entry.syncStatus === 'local') {
      return {
        label: 'Di buku stok',
        icon: CheckCircle2,
        className: 'text-sky-700 bg-sky-50 border-sky-200',
      };
    }
    if (entry.syncStatus === 'failed') {
      return {
        label: 'Perlu dicoba lagi',
        icon: AlertTriangle,
        className: 'text-amber-700 bg-amber-50 border-amber-200',
      };
    }
    return {
      label: 'Menunggu',
      icon: Clock3,
      className: 'text-slate-600 bg-slate-50 border-slate-200',
    };
  };

  return (
    <div className="min-h-[100dvh] w-full bg-background flex flex-col items-center pb-12">
      {/* Header */}
      <header className="w-full max-w-md bg-primary text-primary-foreground pt-10 pb-6 px-6 shadow-md rounded-b-3xl mb-6 sticky top-0 z-10">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h1 className="text-2xl font-serif font-bold tracking-tight">Erlangga</h1>
            <h2 className="text-sm text-primary-foreground/80 font-medium">Pencatatan Stok Toko</h2>
            <nav className="mt-4 flex flex-wrap gap-2" aria-label="Navigasi utama">
              <Link href="/operasional" className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/25" data-testid="link-operations">
                Kunjungan & barang masuk
              </Link>
              <Link href="/dashboard" className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/25" data-testid="link-sales-dashboard">
                Penjualan harian
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/10 rounded-full" title={health?.status ?? 'Status koneksi'}>
              <div className={`w-2 h-2 rounded-full ${health?.status === 'ok' ? 'bg-emerald-300' : 'bg-amber-300'}`} />
              <span className="text-xs font-medium">{health?.status === 'ok' ? 'Terhubung' : 'Memeriksa'}</span>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="w-full max-w-md px-4 flex-1 flex flex-col gap-6">
        <div className="bg-card border border-border shadow-sm rounded-2xl p-5 relative overflow-hidden">
          {/* Decorative accent blob */}
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-accent/10 rounded-full blur-2xl pointer-events-none" />
          
          <form onSubmit={handleSubmit} className="flex flex-col gap-5 relative z-10">
            {/* Store Name */}
            <div className="space-y-1.5">
               <label htmlFor="store" className="text-sm font-semibold text-foreground flex items-center gap-2">
                 <Box size={16} className="text-muted-foreground" /> Toko Aktif
              </label>
              <input
                id="store"
                type="text"
                list="known-stores-home"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-sm font-medium placeholder:text-muted-foreground/50"
                placeholder="Contoh: Toko Sentosa"
                required
              />
               <p className="px-1 text-[11px] text-muted-foreground">
                  Saldo terpadu dan riwayat hanya menampilkan toko ini.
               </p>
                <datalist id="known-stores-home">
                  {(storesQuery.data ?? []).map((store) => <option key={store.name} value={store.name} />)}
                </datalist>
            </div>

            {/* Transaction Type */}
            <div className="space-y-1.5">
              <label htmlFor="transaction" className="text-sm font-semibold text-foreground flex items-center gap-2">
                <RefreshCw size={16} className="text-muted-foreground" /> Tipe Transaksi
              </label>
              <div className="relative">
                <select
                  id="transaction"
                  value={transaction}
                  onChange={(e) => setTransaction(e.target.value)}
                  className="w-full px-4 py-2.5 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-sm appearance-none font-medium"
                  required
                >
                  {TRANSACTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-muted-foreground">
                  <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            </div>

            {/* Product Select with Scanner */}
            <div className="space-y-1.5">
              <label htmlFor="product" className="text-sm font-semibold text-foreground flex items-center gap-2">
                <PackageSearch size={16} className="text-muted-foreground" /> Produk
              </label>
              
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <select
                    id="product"
                    value={selectedBarcode}
                    onChange={(e) => setSelectedBarcode(e.target.value)}
                    className="w-full h-[46px] px-4 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-sm appearance-none font-medium pr-8 truncate"
                    required
                  >
                    <option value="" disabled>Pilih Produk...</option>
                    {categories.map(cat => (
                      <optgroup key={cat} label={cat}>
                        {products.filter(p => p.category === cat).map(p => (
                          <option key={p.barcode} value={p.barcode}>{p.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-muted-foreground">
                    <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
                
                <button
                  type="button"
                  onClick={() => setIsScannerOpen(true)}
                  className={`flex-none w-[46px] h-[46px] bg-accent text-accent-foreground rounded-xl shadow-sm hover:brightness-110 transition-all active:scale-95 flex items-center justify-center ${isScannerOpen ? 'animate-pulse' : ''}`}
                  aria-label="Scan Barcode"
                >
                  <QrCode size={22} />
                </button>
              </div>
              {selectedBarcode && (
                <p className="text-xs text-muted-foreground px-1 font-mono">Barcode: {selectedBarcode}</p>
              )}
              {selectedBalance && (
                <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Saldo terpadu saat ini</p>
                    <p className="text-[11px] text-muted-foreground">
                      Saldo untuk SKU yang dipilih
                    </p>
                  </div>
                  <span className="text-xl font-bold text-primary">{selectedBalance.totalQuantity}</span>
                </div>
              )}
            </div>

            {/* Quantity */}
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {isPhysicalCorrection ? 'Jumlah koreksi per lokasi' : transaction === 'Penjualan' ? 'Jumlah penjualan per lokasi' : 'Jumlah stok per lokasi'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isPhysicalCorrection
                    ? transaction === 'Koreksi Stok +'
                      ? 'Menambah saldo untuk SKU yang sudah ada, misalnya barang yang baru ditemukan.'
                      : 'Mengurangi saldo buku jika jumlah fisik lebih sedikit.'
                    : isNegativeMovement
                      ? 'Jumlah ini mengurangi saldo buku.'
                      : 'Jumlah ini menambah saldo buku.'}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {([
                  ['displayQuantity', 'Display', displayQuantity, setDisplayQuantity],
                  ['secondaryDisplayQuantity', 'Secondary', secondaryDisplayQuantity, setSecondaryDisplayQuantity],
                  ['warehouseQuantity', 'Gudang', warehouseQuantity, setWarehouseQuantity],
                ] as const).map(([id, label, value, setValue]) => (
                  <label key={id} htmlFor={id} className="min-w-0 space-y-1.5">
                    <span className="block truncate text-xs font-semibold text-muted-foreground">{label}</span>
                    <input
                      id={id}
                      type="number"
                      min="0"
                      step="1"
                      value={value}
                      onChange={(event) => setValue(event.target.value ? parseInt(event.target.value, 10) : '')}
                      className="w-full rounded-xl border border-border bg-background px-2 py-3 text-center text-lg font-bold tracking-tight focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                      placeholder="0"
                      inputMode="numeric"
                      data-testid={`input-${id}`}
                    />
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-xl border border-accent/40 bg-accent/10 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Total transaksi</p>
                  <p className="text-xs text-muted-foreground">
                    {isNegativeMovement ? 'Mengurangi saldo toko' : 'Menambah saldo toko'}
                  </p>
                </div>
                <span className="text-2xl font-bold tracking-tight text-primary" data-testid="value-stock-addition">
                  {isNegativeMovement ? `−${totalStock}` : `+${totalStock}`}
                </span>
              </div>
              <p className="px-1 text-xs text-muted-foreground">
                Input, barang masuk, penjualan, dan koreksi dicatat dalam satu buku stok. Untuk menghitung stok fisik lengkap, gunakan Kunjungan; angka kunjungan akan menjadi koreksi selisih, bukan tambahan.
              </p>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitMutation.isPending}
              className="w-full mt-2 py-3.5 bg-primary text-primary-foreground font-semibold rounded-xl shadow-md shadow-primary/20 hover:bg-primary/90 transition-all active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2 text-lg group"
            >
              {submitMutation.isPending ? (
                <>
                  <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Menyimpan...
                </>
              ) : (
                <>
                  <Send size={20} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                  Simpan Data
                </>
              )}
            </button>
          </form>
        </div>

        <ProductManager 
          products={products} 
          onAdd={addProduct} 
          onRemove={removeProduct} 
          onUpdate={updateProduct}
          onReplace={replaceProducts}
        />

        <section className="bg-card border border-border shadow-sm rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Cloud size={18} className="text-primary" />
                <h2 className="font-serif text-lg font-bold text-foreground">Stok toko & riwayat transaksi</h2>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {activeStore
                  ? `Data ${activeStore} diperbarui otomatis setiap beberapa detik.`
                  : 'Masukkan nama toko aktif untuk melihat saldo dan riwayatnya.'}
              </p>
            </div>
            <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground border border-border rounded-full px-2 py-1">
              Live
            </span>
          </div>

          {!activeStore ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center">
              <p className="text-sm font-medium text-foreground">Toko belum dipilih</p>
              <p className="text-xs text-muted-foreground mt-1">
                Isi Toko Aktif di atas agar data toko lain tidak ikut tercampur.
              </p>
            </div>
          ) : entriesError || balancesError ? (
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-5 text-center" role="alert">
              <p className="text-sm font-semibold text-foreground">Data toko belum dapat dimuat</p>
              <p className="mt-1 text-xs text-muted-foreground">Saldo tetap tersimpan. Periksa koneksi lalu coba muat ulang.</p>
              <button type="button" onClick={() => { refetchEntries(); refetchBalances(); }} className="mt-3 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Coba lagi</button>
            </div>
          ) : isRecentLoading || isBalanceLoading ? (
            <div className="space-y-3 py-2" aria-label="Memuat data toko">
              <div className="h-14 animate-pulse rounded-xl bg-muted" />
              <div className="h-14 animate-pulse rounded-xl bg-muted" />
            </div>
          ) : recentEntries.length === 0 && stockBalances.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center">
              <p className="text-sm font-medium text-foreground">Belum ada saldo atau transaksi</p>
              <p className="text-xs text-muted-foreground mt-1">
                Input tambahan atau kunjungan pertama akan menjadi awal saldo toko ini.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {stockBalances.length > 0 && (
                <div className="rounded-xl bg-primary/5 border border-primary/10 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">
                      Stok total per produk
                    </p>
                    <span className="text-[10px] text-muted-foreground" data-testid="text-stock-balance-count">
                      {stockBalances.length} produk · barcode
                    </span>
                  </div>
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    Satu angka total per produk untuk toko ini; sumber stok digabung otomatis.
                  </p>
                  <div className="space-y-2">
                    {stockBalances.map((balance) => (
                      <div
                        key={`${balance.store}-${balance.barcode}`}
                        className="flex items-center justify-between gap-3 border-t border-primary/10 py-2 first:border-t-0 first:pt-0"
                        data-testid={`row-stock-balance-${balance.barcode}`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{balance.product}</p>
                          <p className="text-[11px] text-muted-foreground font-mono truncate">{balance.barcode}</p>
                        </div>
                        <span
                          className="shrink-0 text-lg font-bold text-primary"
                          data-testid={`text-stock-balance-quantity-${balance.barcode}`}
                        >
                          {balance.totalQuantity}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {recentEntries.length > 0 && (
                <div className={stockBalances.length > 0 ? "border-t border-border pt-3" : ""}>
                  <p className="text-xs font-semibold text-foreground">Buku stok · pergerakan terbaru</p>
                  <p className="mb-2 mt-1 text-[11px] text-muted-foreground">
                    Input, penjualan, barang masuk, dan koreksi fisik tercatat bersama. Saldo dihitung dari pergerakan ini.
                  </p>
                </div>
              )}
              {recentEntries.map((entry) => {
                const syncMeta = getSyncMeta(entry);
                const SyncIcon = syncMeta.icon;
                const movementQuantity = entry.transaction.trim().toLocaleLowerCase('id-ID') === 'penjualan'
                  ? -entry.quantity
                  : entry.quantity;
                return (
                  <div key={entry.id} className="rounded-xl border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{entry.product}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {entry.transaction} · {movementQuantity > 0 ? '+' : ''}{movementQuantity} stok ·{' '}
                          {new Date(entry.occurredAt || entry.createdAt).toLocaleString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${syncMeta.className}`}>
                          <SyncIcon size={12} />
                          {syncMeta.label}
                        </span>
                        {entry.sourceType === 'manual' ? (
                          <button
                            type="button"
                            onClick={() => deleteEntry(entry)}
                            disabled={deleteEntryMutation.isPending}
                            className="rounded-lg p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                            aria-label={`Hapus catatan ${entry.product}`}
                            data-testid={`button-delete-stock-entry-${entry.id}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : (
                          <span className="px-1 text-[10px] text-muted-foreground" title="Kelola dari riwayat operasional">
                            Kelola dari sumber
                          </span>
                        )}
                      </div>
                    </div>
                    {entry.syncStatus === 'failed' && (
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                        <p className="text-xs text-muted-foreground">
                          Server sudah menyimpan data ini.
                        </p>
                        <button
                          type="button"
                          onClick={() => retryMutation.mutate({ id: entry.id })}
                          disabled={retryMutation.isPending}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                        >
                          <RotateCcw size={13} />
                          Coba Lagi
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <BarcodeScanner 
        isOpen={isScannerOpen} 
        onClose={() => setIsScannerOpen(false)} 
        onScanSuccess={handleScanSuccess} 
      />
    </div>
  );
}
