import React, { useState, useMemo, useCallback } from 'react';
import { useProducts } from '@/hooks/useProducts';
import { useStoreName } from '@/hooks/useStoreName';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { ProductManager } from '@/components/ProductManager';
import { ThemeToggle } from '@/components/theme-toggle';
import { useToast } from '@/hooks/use-toast';
import {
  Box,
  CheckCircle2,
  Cloud,
  PackageSearch,
  QrCode,
  RefreshCw,
  Send,
  Trash2,
  Plus,
  ShoppingCart,
  Search,
  Camera
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

type CartItem = {
  barcode: string;
  product: string;
  displayQuantity: number;
  secondaryDisplayQuantity: number;
  warehouseQuantity: number;
};

export default function Home() {
  const { products, addProduct, removeProduct, updateProduct, replaceProducts } = useProducts();
  const [storeName, setStoreName] = useStoreName();
  const { toast } = useToast();

  const [transaction, setTransaction] = useState(TRANSACTIONS[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBarcode, setSelectedBarcode] = useState('');
  const [displayQuantity, setDisplayQuantity] = useState<number | ''>('');
  const [secondaryDisplayQuantity, setSecondaryDisplayQuantity] = useState<number | ''>('');
  const [warehouseQuantity, setWarehouseQuantity] = useState<number | ''>('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  
  // STATE UNTUK KERANJANG
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const [historyLimit, setHistoryLimit] = useState(5);

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
    { store: activeStore, limit: historyLimit },
    {
      query: {
        queryKey: getListStockEntriesQueryKey({ store: activeStore, limit: historyLimit }),
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

  const submitMutation = useCreateStockEntry();

  // FUNGSI TAMBAH KE KERANJANG
  const handleAddToCart = () => {
    const product = products.find(p => p.barcode === selectedBarcode);
    const hasQuantity = displayQuantity !== '' || secondaryDisplayQuantity !== '' || warehouseQuantity !== '';
    
    if (!selectedBarcode || !hasQuantity) {
      toast({ title: 'Peringatan', description: 'Pilih produk dan isi jumlahnya terlebih dahulu.', variant: 'destructive' });
      return;
    }

    if (cart.some(item => item.barcode === selectedBarcode)) {
      toast({ title: 'Perhatian', description: 'Produk ini sudah ada di dalam keranjang.', variant: 'destructive' });
      return;
    }

    setCart(prev => [...prev, {
      barcode: selectedBarcode,
      product: product ? product.name : searchQuery,
      displayQuantity: Number(displayQuantity || 0),
      secondaryDisplayQuantity: Number(secondaryDisplayQuantity || 0),
      warehouseQuantity: Number(warehouseQuantity || 0),
    }]);

    // Reset Form
    setSearchQuery('');
    setSelectedBarcode('');
    setDisplayQuantity('');
    setSecondaryDisplayQuantity('');
    setWarehouseQuantity('');
    toast({ title: 'Berhasil', description: 'Produk ditambahkan ke keranjang.' });
  };

  // FUNGSI SIMPAN SEMUA KERANJANG
  const handleSubmitAll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStore) {
      toast({ title: 'Peringatan', description: 'Toko aktif belum diisi.', variant: 'destructive' });
      return;
    }
    if (cart.length === 0) {
      toast({ title: 'Peringatan', description: 'Keranjang masih kosong.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    let successCount = 0;

    try {
      for (const item of cart) {
        const isAdjustment = transaction === 'Koreksi Stok +' || transaction === 'Koreksi Stok -';
        const payload = {
          clientId: globalThis.crypto.randomUUID(),
          store: activeStore,
          transaction,
          product: item.product,
          quantity: item.displayQuantity + item.secondaryDisplayQuantity + item.warehouseQuantity,
          barcode: item.barcode,
          displayQuantity: item.displayQuantity,
          secondaryDisplayQuantity: item.secondaryDisplayQuantity,
          warehouseQuantity: item.warehouseQuantity,
          ...(isAdjustment ? { sourceType: 'adjustment' as const } : {}),
        };

        await submitMutation.mutateAsync({ data: payload as any });
        successCount++;
      }

      toast({ title: 'Berhasil Disimpan', description: `${successCount} produk berhasil dimasukkan ke server.` });
      setCart([]);
      
      queryClient.invalidateQueries({ queryKey: getListStockEntriesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListStockBalancesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetSalesMonitorQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetSalesActivityQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });

    } catch (error: any) {
      toast({ title: 'Gagal Menyimpan', description: error.message || 'Terjadi kesalahan.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleScanSuccess = useCallback((code: string) => {
    setIsScannerOpen(false);
    const product = products.find(p => p.barcode === code);
    if (product) {
      setSelectedBarcode(product.barcode);
      setSearchQuery(product.name);
      toast({ title: 'Barcode Ditemukan', description: `Produk: ${product.name}` });
    } else {
      toast({ title: 'Barcode Tidak Dikenali', description: `${code}. Silakan pilih manual.`, variant: 'destructive' });
      setSelectedBarcode('');
      setSearchQuery('');
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

  const getSyncMeta = () => {
    return {
      label: 'Tersimpan',
      icon: CheckCircle2,
      className: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    };
  };

  return (
    <div className="min-h-[100dvh] w-full bg-background flex flex-col items-center pb-12">
      <header className="w-full max-w-md bg-primary text-primary-foreground pt-10 pb-6 px-6 shadow-md rounded-b-3xl mb-6 sticky top-0 z-10">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h1 className="text-2xl font-serif font-bold tracking-tight">Erlangga</h1>
            <h2 className="text-sm text-primary-foreground/80 font-medium">Pencatatan Stok Toko</h2>
            <nav className="mt-4 flex flex-wrap gap-2" aria-label="Navigasi utama">
              <Link href="/operasional" className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/25">
                Kunjungan & barang masuk
              </Link>
              <Link href="/dashboard" className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/25">
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
          <form className="flex flex-col gap-5 relative z-10">
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
                className="w-full px-4 py-2.5 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 text-sm font-medium"
                placeholder="Contoh: Toko Sentosa"
                required
              />
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
                  className="w-full px-4 py-2.5 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 text-sm appearance-none font-medium"
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

            {/* Pencarian Produk / Barcode */}
            <div className="space-y-1.5">
              <label htmlFor="product-search" className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Search size={16} className="text-muted-foreground" /> Cari / Scan Produk
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="product-search"
                    list="product-list"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      const match = products.find(p => p.name.toLowerCase().includes(e.target.value.toLowerCase()) || p.barcode === e.target.value);
                      setSelectedBarcode(match ? match.barcode : '');
                    }}
                    placeholder="Ketik nama / barcode..."
                    className="w-full h-[46px] px-4 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 text-sm"
                  />
                  <datalist id="product-list">
                    {products.map(p => <option key={p.barcode} value={p.name}>{p.barcode}</option>)}
                  </datalist>
                </div>
                <button
                  type="button"
                  onClick={() => setIsScannerOpen(true)}
                  className="flex-none w-[46px] h-[46px] bg-accent text-accent-foreground rounded-xl shadow-sm hover:brightness-110 flex items-center justify-center"
                >
                  <Camera size={22} />
                </button>
              </div>
              {selectedBalance && (
                <p className="text-xs text-primary font-semibold px-1">Saldo terpadu saat ini: {selectedBalance.totalQuantity}</p>
              )}
            </div>

            {/* Quantity */}
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Jumlah stok per lokasi</p>
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
                      value={value}
                      onChange={(event) => setValue(event.target.value ? parseInt(event.target.value, 10) : '')}
                      className="w-full rounded-xl border border-border bg-background px-2 py-3 text-center text-lg font-bold tracking-tight focus:border-primary focus:outline-none"
                      placeholder="0"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Tombol Tambah ke Keranjang */}
            <button
              type="button"
              onClick={handleAddToCart}
              className="w-full mt-2 py-3 bg-secondary text-secondary-foreground font-semibold rounded-xl shadow-sm hover:opacity-90 transition-all flex items-center justify-center gap-2"
            >
              <Plus size={20} />
              Tambah ke Keranjang
            </button>
          </form>
        </div>

        {/* KERANJANG SECTION */}
        <div className="bg-card border border-border shadow-sm rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-lg font-bold flex items-center gap-2">
              <ShoppingCart size={18} className="text-primary" /> Keranjang
            </h2>
            <span className="text-xs font-semibold bg-muted px-2 py-1 rounded-full">{cart.length} SKU</span>
          </div>
          
          {cart.length === 0 ? (
            <div className="text-center py-6 border border-dashed rounded-xl text-muted-foreground text-sm">
              Belum ada barang di keranjang.
            </div>
          ) : (
            <ul className="space-y-3 mb-4">
              {cart.map((item, idx) => {
                const total = item.displayQuantity + item.secondaryDisplayQuantity + item.warehouseQuantity;
                return (
                  <li key={idx} className="flex justify-between items-center bg-muted/30 p-3 rounded-xl border border-border">
                    <div>
                      <p className="text-sm font-semibold">{item.product}</p>
                      <p className="text-xs text-muted-foreground">D: {item.displayQuantity} | S: {item.secondaryDisplayQuantity} | G: {item.warehouseQuantity}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold">{total}</span>
                      <button onClick={() => setCart(cart.filter((_, i) => i !== idx))} className="text-destructive hover:bg-destructive/10 p-1.5 rounded-md">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            onClick={handleSubmitAll}
            disabled={isSaving || cart.length === 0}
            className="w-full py-3.5 bg-primary text-primary-foreground font-semibold rounded-xl shadow-md hover:bg-primary/90 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isSaving ? 'Menyimpan...' : <><Send size={20} /> Simpan Semua Data</>}
          </button>
        </div>

        <ProductManager products={products} onAdd={addProduct} onRemove={removeProduct} onUpdate={updateProduct} onReplace={replaceProducts} />

        {/* RIWAYAT SECTION (Sama seperti sebelumnya) */}
        <section className="bg-card border border-border shadow-sm rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Cloud size={18} className="text-primary" />
                <h2 className="font-serif text-lg font-bold text-foreground">Riwayat transaksi</h2>
              </div>
            </div>
          </div>
          
          {recentEntries.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">Belum ada transaksi.</p>
          ) : (
            <div className="space-y-3">
              {recentEntries.map((entry) => {
                const syncMeta = getSyncMeta();
                const SyncIcon = syncMeta.icon;
                return (
                  <div key={entry.id} className="rounded-xl border border-border p-3 flex justify-between items-center">
                    <div>
                      <p className="text-sm font-semibold truncate">{entry.product}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{entry.transaction} · {entry.quantity} stok</p>
                    </div>
                     <button onClick={() => deleteEntry(entry)} className="p-2 text-muted-foreground hover:text-destructive">
                        <Trash2 size={14} />
                      </button>
                  </div>
                );
              })}
              {recentEntries.length >= historyLimit && (
                <button onClick={() => setHistoryLimit(prev => prev + 5)} className="w-full mt-2 py-2 text-sm font-semibold text-primary border border-primary/30 rounded-xl">Muat Lebih Banyak</button>
              )}
            </div>
          )}
        </section>
      </main>

      <BarcodeScanner isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScanSuccess={handleScanSuccess} />
    </div>
  );
}
