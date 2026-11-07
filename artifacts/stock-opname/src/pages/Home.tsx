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
  
  const { data: health } = useHealthCheck({
    query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30_000 },
  });
  const storesQuery = useListStores({
    query: { queryKey: getListStoresQueryKey(), staleTime: 5 * 60 * 1000 },
  });

  const { data: recentEntries = [], isLoading: isRecentLoading } = useListStockEntries(
    { store: activeStore, limit: historyLimit },
    {
      query: {
        queryKey: getListStockEntriesQueryKey({ store: activeStore, limit: historyLimit }),
        refetchInterval: 5000,
        enabled: Boolean(activeStore),
      },
    },
  );
  const { data: stockBalances = [], isLoading: isBalanceLoading } = useListStockBalances(
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
        toast({ title: 'Catatan dihapus', description: 'Saldo toko diperbarui.' });
      }
    });
  };

  const submitMutation = useCreateStockEntry();

  const handleAddToCart = () => {
    const product = products.find(p => p.barcode === selectedBarcode);
    const hasQuantity = displayQuantity !== '' || secondaryDisplayQuantity !== '' || warehouseQuantity !== '';
    
    if (!selectedBarcode || !hasQuantity) {
      toast({ title: 'Peringatan', description: 'Pilih produk dan isi jumlahnya.', variant: 'destructive' });
      return;
    }

    if (cart.some(item => item.barcode === selectedBarcode)) {
      toast({ title: 'Perhatian', description: 'Produk ini sudah ada di keranjang.', variant: 'destructive' });
      return;
    }

    setCart(prev => [...prev, {
      barcode: selectedBarcode,
      product: product ? product.name : searchQuery,
      displayQuantity: Number(displayQuantity || 0),
      secondaryDisplayQuantity: Number(secondaryDisplayQuantity || 0),
      warehouseQuantity: Number(warehouseQuantity || 0),
    }]);

    setSearchQuery('');
    setSelectedBarcode('');
    setDisplayQuantity('');
    setSecondaryDisplayQuantity('');
    setWarehouseQuantity('');
    toast({ title: 'Berhasil', description: 'Produk ditambahkan ke keranjang.' });
  };

  const handleSubmitAll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStore || cart.length === 0) {
      toast({ title: 'Peringatan', description: 'Toko atau keranjang belum siap.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    let successCount = 0;

    try {
      for (const item of cart) {
        const isAdjustment = transaction === 'Koreksi Stok +' || transaction === 'Koreksi Stok -';
        await submitMutation.mutateAsync({ data: {
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
        } as any });
        successCount++;
      }

      toast({ title: 'Berhasil', description: `${successCount} produk disimpan.` });
      setCart([]);
      queryClient.invalidateQueries({ queryKey: getListStockEntriesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListStockBalancesQueryKey() });
    } catch (error: any) {
      toast({ title: 'Gagal', description: error.message, variant: 'destructive' });
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
      toast({ title: 'Ditemukan', description: product.name });
    } else {
      toast({ title: 'Tidak Dikenali', description: code, variant: 'destructive' });
    }
  }, [products, toast]);

  const selectedBalance = useMemo<StockBalance | undefined>(
    () => stockBalances.find((balance) => balance.barcode === selectedBarcode),
    [selectedBarcode, stockBalances],
  );

  return (
    <div className="min-h-[100dvh] w-full bg-background flex flex-col items-center pb-12">
      <header className="w-full max-w-md bg-primary text-primary-foreground pt-10 pb-6 px-6 shadow-md rounded-b-3xl mb-6 sticky top-0 z-10">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h1 className="text-2xl font-serif font-bold tracking-tight">Erlangga</h1>
            <nav className="mt-4 flex flex-wrap gap-2">
              <Link href="/operasional" className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold">Kunjungan</Link>
              <Link href="/dashboard" className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold">Laporan</Link>
            </nav>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="w-full max-w-md px-4 flex-1 flex flex-col gap-6">
        <div className="bg-card border border-border shadow-sm rounded-2xl p-5">
          <form className="flex flex-col gap-5">
            <div className="space-y-1.5">
               <label className="text-sm font-semibold flex items-center gap-2"><Box size={16} /> Toko Aktif</label>
              <input
                list="known-stores-home"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-sm font-medium"
                placeholder="Contoh: Toko Sentosa"
              />
              <datalist id="known-stores-home">
                {(storesQuery.data ?? []).map((store) => <option key={store.name} value={store.name} />)}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold flex items-center gap-2"><RefreshCw size={16} /> Tipe Transaksi</label>
              <select
                value={transaction}
                onChange={(e) => setTransaction(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-sm font-medium"
              >
                {TRANSACTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* FITUR PENCARIAN YANG SUDAH DISAMAKAN DENGAN KUNJUNGAN */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold flex items-center gap-2"><Search size={16} /> Cari / Scan Produk</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    list="product-list-home"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      // Logika pencarian sama seperti Kunjungan
                      const match = products.find(p => p.barcode === e.target.value.trim() || p.name.toLowerCase() === e.target.value.toLowerCase());
                      setSelectedBarcode(match ? match.barcode : '');
                    }}
                    placeholder="Ketik nama / barcode..."
                    className="w-full h-[46px] px-4 bg-background border border-border rounded-xl text-sm"
                  />
                  <datalist id="product-list-home">
                    {products.map(p => (
                      <option key={p.barcode} value={p.barcode} label={p.name} />
                    ))}
                  </datalist>
                </div>
                <button type="button" onClick={() => setIsScannerOpen(true)} className="flex-none w-[46px] h-[46px] bg-accent text-accent-foreground rounded-xl flex items-center justify-center">
                  <Camera size={22} />
                </button>
              </div>
              {selectedBalance && <p className="text-xs text-primary font-semibold px-1">Saldo: {selectedBalance.totalQuantity}</p>}
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold">Jumlah stok</p>
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  ['displayQuantity', 'Display', displayQuantity, setDisplayQuantity],
                  ['secondaryDisplayQuantity', 'Secondary', secondaryDisplayQuantity, setSecondaryDisplayQuantity],
                  ['warehouseQuantity', 'Gudang', warehouseQuantity, setWarehouseQuantity],
                ].map(([id, label, value, setValue]: any) => (
                  <label key={id} className="space-y-1.5">
                    <span className="block text-xs font-semibold text-muted-foreground">{label}</span>
                    <input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value ? parseInt(e.target.value, 10) : '')} className="w-full rounded-xl border border-border bg-background px-2 py-3 text-center text-lg font-bold" placeholder="0" />
                  </label>
                ))}
              </div>
            </div>

            <button type="button" onClick={handleAddToCart} className="w-full py-3 bg-secondary text-secondary-foreground font-semibold rounded-xl flex items-center justify-center gap-2">
              <Plus size={20} /> Tambah ke Keranjang
            </button>
          </form>
        </div>

        <div className="bg-card border border-border shadow-sm rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-lg font-bold flex items-center gap-2"><ShoppingCart size={18} /> Keranjang</h2>
            <span className="text-xs font-semibold bg-muted px-2 py-1 rounded-full">{cart.length} SKU</span>
          </div>
          
          {cart.length === 0 ? (
            <div className="text-center py-6 border border-dashed rounded-xl text-muted-foreground text-sm">Belum ada barang.</div>
          ) : (
            <ul className="space-y-3 mb-4">
              {cart.map((item, idx) => (
                <li key={idx} className="flex justify-between items-center bg-muted/30 p-3 rounded-xl border border-border">
                  <div>
                    <p className="text-sm font-semibold">{item.product}</p>
                    <p className="text-xs text-muted-foreground">D: {item.displayQuantity} | S: {item.secondaryDisplayQuantity} | G: {item.warehouseQuantity}</p>
                  </div>
                  <button onClick={() => setCart(cart.filter((_, i) => i !== idx))} className="text-destructive p-1.5"><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          )}

          <button onClick={handleSubmitAll} disabled={isSaving || cart.length === 0} className="w-full py-3.5 bg-primary text-primary-foreground font-semibold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
            {isSaving ? 'Menyimpan...' : <><Send size={20} /> Simpan Semua</>}
          </button>
        </div>

        <section className="bg-card border border-border shadow-sm rounded-2xl p-5">
          <h2 className="font-serif text-lg font-bold mb-4">Riwayat</h2>
          {recentEntries.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">Belum ada transaksi.</p>
          ) : (
            <div className="space-y-3">
              {recentEntries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-border p-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-semibold">{entry.product}</p>
                    <p className="text-xs text-muted-foreground">{entry.transaction} · {entry.quantity} stok</p>
                  </div>
                   <button onClick={() => deleteEntry(entry)} className="p-2 text-muted-foreground"><Trash2 size={14} /></button>
                </div>
              ))}
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
