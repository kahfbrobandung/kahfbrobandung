import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useProducts, type Product } from '@/hooks/useProducts';
import { useStoreName } from '@/hooks/useStoreName';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { ProductManager } from '@/components/ProductManager';
import { ThemeToggle } from '@/components/theme-toggle';
import { useToast } from '@/hooks/use-toast';
import {
  Box, RefreshCw, Send, Trash2, Plus, Minus, ShoppingCart, Search, Camera, X, Package, LogOut
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { supabase } from '@/lib/supabase';
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
  useListStockBalances,
} from '@workspace/api-client-react';

const TRANSACTIONS = ['Input Stok', 'Stock Awal', 'Penjualan', 'Koreksi Stok +', 'Koreksi Stok -', 'Pembelian', 'Retur', 'Lainnya'];

type CartItem = {
  product: Product;
  displayQuantity: number;
  secondaryDisplayQuantity: number;
  warehouseQuantity: number;
};

export default function Home() {
  const { products, addProduct, removeProduct, updateProduct, replaceProducts } = useProducts();
  const [storeName, setStoreName] = useStoreName();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [transaction, setTransaction] = useState(TRANSACTIONS[0]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  
  // Pencarian
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Input Qty
  const [displayQuantity, setDisplayQuantity] = useState<string>('');
  const [secondaryDisplayQuantity, setSecondaryDisplayQuantity] = useState<string>('');
  const [warehouseQuantity, setWarehouseQuantity] = useState<string>('');
  
  // Keranjang
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const queryClient = useQueryClient();
  const activeStore = storeName.trim();

  // Queries
  const { data: health } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30000 } });
  const storesQuery = useListStores({ query: { queryKey: getListStoresQueryKey(), staleTime: 300000 } });
  
  // Hanya query saldo yang dipertahankan
  const { data: stockBalances = [] } = useListStockBalances(
    { store: activeStore },
    { query: { queryKey: getListStockBalancesQueryKey({ store: activeStore }), refetchInterval: 5000, enabled: !!activeStore } }
  );

  // Mutations
  const submitMutation = useCreateStockEntry();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setLocation('/login');
  };

  const filteredProducts = useMemo(() => {
    if (!searchQuery) return [];
    const lowerQuery = searchQuery.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(lowerQuery) || p.barcode.includes(lowerQuery)).slice(0, 5);
  }, [searchQuery, products]);

  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    setSearchQuery(product.name);
    setShowSearchResults(false);
    setDisplayQuantity(''); setSecondaryDisplayQuantity(''); setWarehouseQuantity('');
  };

  const handleScanSuccess = useCallback((code: string) => {
    setIsScannerOpen(false);
    const product = products.find(p => p.barcode === code);
    if (product) {
      handleSelectProduct(product);
      toast({ title: 'Barcode Ditemukan', description: product.name });
    } else {
      toast({ title: 'Tidak Dikenali', description: `Barcode ${code} belum terdaftar.`, variant: 'destructive' });
    }
  }, [products, toast]);

  const handleAddToCart = () => {
    if (!selectedProduct) return toast({ title: 'Perhatian', description: 'Pilih produk.', variant: 'destructive' });
    
    const dQty = parseInt(displayQuantity || '0', 10);
    const sQty = parseInt(secondaryDisplayQuantity || '0', 10);
    const wQty = parseInt(warehouseQuantity || '0', 10);

    if (dQty === 0 && sQty === 0 && wQty === 0) return toast({ title: 'Perhatian', description: 'Isi minimal satu jumlah stok.', variant: 'destructive' });

    const existingIndex = cart.findIndex(item => item.product.barcode === selectedProduct.barcode);
    if (existingIndex >= 0) {
      const newCart = [...cart];
      newCart[existingIndex].displayQuantity += dQty;
      newCart[existingIndex].secondaryDisplayQuantity += sQty;
      newCart[existingIndex].warehouseQuantity += wQty;
      setCart(newCart);
    } else {
      setCart([...cart, { product: selectedProduct, displayQuantity: dQty, secondaryDisplayQuantity: sQty, warehouseQuantity: wQty }]);
    }

    setSelectedProduct(null); setSearchQuery(''); setDisplayQuantity(''); setSecondaryDisplayQuantity(''); setWarehouseQuantity('');
    toast({ title: 'Berhasil', description: 'Ditambahkan ke keranjang.' });
  };

  const updateCartQty = (index: number, field: keyof Omit<CartItem, 'product'>, delta: number) => {
    const newCart = [...cart];
    const newValue = Math.max(0, newCart[index][field] + delta);
    newCart[index][field] = newValue;
    if (newCart[index].displayQuantity === 0 && newCart[index].secondaryDisplayQuantity === 0 && newCart[index].warehouseQuantity === 0) {
      newCart.splice(index, 1);
    }
    setCart(newCart);
  };

  const handleSubmitAll = async () => {
    if (!activeStore || cart.length === 0) return;
    setIsSaving(true);
    let successCount = 0;
    try {
      for (const item of cart) {
        const isAdjustment = transaction.includes('Koreksi');
        await submitMutation.mutateAsync({ data: {
          clientId: globalThis.crypto.randomUUID(), store: activeStore, transaction, product: item.product.name,
          quantity: item.displayQuantity + item.secondaryDisplayQuantity + item.warehouseQuantity,
          barcode: item.product.barcode, displayQuantity: item.displayQuantity,
          secondaryDisplayQuantity: item.secondaryDisplayQuantity, warehouseQuantity: item.warehouseQuantity,
          ...(isAdjustment ? { sourceType: 'adjustment' as const } : {}),
        } as any });
        successCount++;
      }
      toast({ title: 'Berhasil', description: `${successCount} produk disimpan.` });
      setCart([]);
      queryClient.invalidateQueries({ queryKey: getListStockBalancesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetSalesMonitorQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetSalesActivityQueryKey() });
    } catch (error: any) {
      toast({ title: 'Gagal', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const selectedBalance = selectedProduct ? stockBalances.find(b => b.barcode === selectedProduct.barcode) : null;

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-950 flex flex-col items-center pb-24">
      <header className="w-full max-w-md bg-emerald-900 text-white pt-12 pb-6 px-6 shadow-lg rounded-b-[2rem] mb-6 sticky top-0 z-20">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-3xl font-serif font-bold tracking-tight">Erlangga</h1>
            <p className="text-emerald-100/80 text-sm mt-1">Sistem Pencatatan Stok</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 bg-red-500/90 hover:bg-red-600 active:scale-95 transition-all px-3 py-2 rounded-lg text-xs font-bold"
            >
              <LogOut size={14} /> Logout
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/operasional" className="flex-1 bg-white/10 hover:bg-white/20 transition-colors rounded-xl py-2 text-center text-xs font-semibold">Kunjungan SO</Link>
          <Link href="/dashboard" className="flex-1 bg-white/10 hover:bg-white/20 transition-colors rounded-xl py-2 text-center text-xs font-semibold">Laporan</Link>
        </div>
      </header>

      <main className="w-full max-w-md px-4 flex flex-col gap-5">
        
        {/* FORM INPUT & KERANJANG */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-2xl p-5">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><Box size={12} /> Toko</label>
                <select 
                  value={storeName} 
                  onChange={e => setStoreName(e.target.value)} 
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm font-medium focus:ring-2 focus:ring-emerald-500 outline-none appearance-none"
                >
                  <option value="" disabled>Pilih Toko...</option>
                  {(storesQuery.data ?? []).map(s => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><RefreshCw size={12} /> Transaksi</label>
                <select value={transaction} onChange={e => setTransaction(e.target.value)} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm font-medium focus:ring-2 focus:ring-emerald-500 outline-none appearance-none">
                  {TRANSACTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1 relative" ref={searchContainerRef}>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><Search size={12} /> Cari Produk</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input type="text" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setSelectedProduct(null); setShowSearchResults(true); }} onFocus={() => setShowSearchResults(true)} placeholder="Ketik nama atau scan barcode..." className="w-full pl-9 pr-8 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm font-medium focus:ring-2 focus:ring-emerald-500 outline-none" />
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  {searchQuery && <button onClick={() => { setSearchQuery(''); setSelectedProduct(null); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>}
                </div>
                <button onClick={() => setIsScannerOpen(true)} className="flex-none px-3 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-lg flex items-center justify-center transition-colors"><Camera size={20} /></button>
              </div>

              {showSearchResults && searchQuery && !selectedProduct && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
                  {filteredProducts.length === 0 ? <div className="p-4 text-center text-sm text-slate-500">Produk tidak ditemukan.</div> : (
                    <ul className="max-h-60 overflow-y-auto">
                      {filteredProducts.map(p => (
                        <li key={p.barcode} onClick={() => handleSelectProduct(p)} className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer flex flex-col">
                          <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">{p.name}</span>
                          <span className="text-xs text-slate-500 font-mono mt-0.5">{p.barcode}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {selectedProduct && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-2">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">{selectedProduct.name}</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">{selectedProduct.barcode}</p>
                  </div>
                  {selectedBalance && <span className="text-xs font-semibold bg-emerald-200 dark:bg-emerald-800 px-2 py-1 rounded-md text-emerald-800 dark:text-emerald-200">Sisa: {selectedBalance.totalQuantity}</span>}
                </div>
                
                <div className="grid grid-cols-3 gap-2">
                  {[['display', 'Display', displayQuantity, setDisplayQuantity],['secondary', 'Secondary', secondaryDisplayQuantity, setSecondaryDisplayQuantity],['gudang', 'Gudang', warehouseQuantity, setWarehouseQuantity]].map(([key, label, val, setVal]: any) => (
                    <div key={key} className="space-y-1">
                      <label className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 text-center block">{label}</label>
                      <input type="number" min="0" placeholder="0" value={val} onChange={e => setVal(e.target.value)} className="w-full text-center py-2 bg-white dark:bg-slate-950 border border-emerald-200 dark:border-emerald-800 rounded-lg font-bold text-lg outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                  ))}
                </div>
                <button onClick={handleAddToCart} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"><Plus size={16} /> Tambah ke Keranjang</button>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-lg font-bold flex items-center gap-2"><ShoppingCart size={18} className="text-emerald-600" /> Keranjang</h2>
            <span className="text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2.5 py-1 rounded-full">{cart.length} Item</span>
          </div>
          
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400">
              <ShoppingCart size={32} className="mb-2 opacity-20" />
              <p className="text-sm">Belum ada barang di keranjang.</p>
            </div>
          ) : (
            <div className="space-y-3 mb-5">
              {cart.map((item, idx) => (
                <div key={idx} className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col gap-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-sm text-slate-800 dark:text-slate-100">{item.product.name}</p>
                      <p className="text-[11px] text-slate-500 font-mono mt-0.5">{item.product.barcode}</p>
                    </div>
                    <button onClick={() => setCart(cart.filter((_, i) => i !== idx))} className="text-red-500 p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><Trash2 size={16} /></button>
                  </div>
                  
                  <div className="flex items-center gap-2 mt-1">
                    {['displayQuantity', 'secondaryDisplayQuantity', 'warehouseQuantity'].map((field, i) => (
                      <div key={field} className="flex-1 flex flex-col items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-1">
                        <span className="text-[9px] font-bold text-slate-400 uppercase">{['Dsp', 'Sec', 'Gdg'][i]}</span>
                        <div className="flex items-center justify-between w-full mt-1">
                          <button onClick={() => updateCartQty(idx, field as any, -1)} className="p-1 text-slate-400 hover:text-slate-800"><Minus size={12} /></button>
                          <span className="font-bold text-sm">{(item as any)[field]}</span>
                          <button onClick={() => updateCartQty(idx, field as any, 1)} className="p-1 text-slate-400 hover:text-slate-800"><Plus size={12} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <button onClick={handleSubmitAll} disabled={isSaving || cart.length === 0} className="w-full py-3.5 bg-emerald-900 hover:bg-emerald-950 text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 transition-all shadow-lg shadow-emerald-900/20">
            {isSaving ? 'Menyimpan Data...' : <><Send size={18} /> Simpan ke Database</>}
          </button>
        </div>

        <ProductManager products={products} onAdd={addProduct} onRemove={removeProduct} onUpdate={updateProduct} onReplace={replaceProducts} />

        {/* --- BAGIAN STOK PRODUK (SALDO) --- */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-2xl p-5">
          <h2 className="font-serif text-lg font-bold flex items-center gap-2 mb-4">
            <Package size={18} className="text-emerald-600" /> Stok Produk Saat Ini
          </h2>
          {stockBalances.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-4">Belum ada stok barang di toko ini.</p>
          ) : (
            <div className="space-y-2">
              {stockBalances.map((balance) => (
                <div key={`${balance.store}-${balance.barcode}`} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
                  <div className="min-w-0 pr-2">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{balance.product}</p>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">{balance.barcode}</p>
                  </div>
                  <span className="shrink-0 text-lg font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30 px-3 py-1 rounded-lg">
                    {balance.totalQuantity}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <BarcodeScanner isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScanSuccess={handleScanSuccess} />
    </div>
  );
}