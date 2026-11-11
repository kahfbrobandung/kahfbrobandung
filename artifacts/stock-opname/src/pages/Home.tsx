import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useProducts, type Product } from '@/hooks/useProducts';
import { useStoreName } from '@/hooks/useStoreName';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { ProductManager } from '@/components/ProductManager';
import { ThemeToggle } from '@/components/theme-toggle';
import { useToast } from '@/hooks/use-toast';
import {
  Box, RefreshCw, Send, Trash2, Plus, Minus, ShoppingCart, Search, Camera, X, Package, LogOut, Store
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { supabase } from '@/supabase'; 
import {
  getGetSalesActivityQueryKey,
  getGetSalesMonitorQueryKey,
  getListStockBalancesQueryKey,
  useCreateStockEntry,
  useListStockBalances,
  customFetch,
} from '@workspace/api-client-react';

const TRANSACTIONS = ['Input Stok', 'Stock Awal', 'Penjualan', 'Koreksi Stok +', 'Koreksi Stok -', 'Pembelian', 'Retur', 'Lainnya'];

type CartItem = {
  product: Product;
  displayQuantity: number;
  secondaryDisplayQuantity: number;
  warehouseQuantity: number;
};

// Helper untuk mencegah input NaN atau angka minus
const parseQty = (val: string): number => {
  const parsed = parseInt(val, 10);
  return isNaN(parsed) || parsed < 0 ? 0 : parsed;
};

export default function Home() {
  const { products, addProduct, removeProduct, updateProduct, replaceProducts } = useProducts();
  const [storeName, setStoreName] = useStoreName();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [transaction, setTransaction] = useState(TRANSACTIONS[0]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  
  // State Tambah Toko
  const [isAddStoreOpen, setIsAddStoreOpen] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [isAddingStore, setIsAddingStore] = useState(false);

  // State Daftar Toko (Bypass API)
  const [dbStores, setDbStores] = useState<string[]>([]);
  const [isLoadingStores, setIsLoadingStores] = useState(true);

  // Pencarian
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  // Input Qty
  const [displayQuantity, setDisplayQuantity] = useState<string>('');
  const [secondaryDisplayQuantity, setSecondaryDisplayQuantity] = useState<string>('');
  const [warehouseQuantity, setWarehouseQuantity] = useState<string>('');
  
  // Keranjang
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const activeStore = storeName.trim();

  // 1. FUNGSI AMBIL TOKO LANGSUNG DARI SUPABASE (Anti Gagal)
  const fetchStores = useCallback(async () => {
    setIsLoadingStores(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;

      const { data, error } = await supabase
        .from('stores')
        .select('name')
        .eq('user_id', session.user.id)
        .order('name');

      if (error) throw error;
      
      if (data) {
        const names = data.map(s => s.name);
        setDbStores(names);
        // Otomatis pilih toko pertama jika belum ada yang dipilih
        if (!storeName && names.length > 0) {
          setStoreName(names[0]);
        }
      }
    } catch (error) {
      console.error("Gagal mengambil daftar toko:", error);
    } finally {
      setIsLoadingStores(false);
    }
  }, [storeName, setStoreName]);

  // Panggil fetchStores saat halaman dimuat
  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  // Ambil saldo stok (tetap pakai API)
  const { data: stockBalances = [] } = useListStockBalances(
    { store: activeStore },
    { query: { queryKey: getListStockBalancesQueryKey({ store: activeStore }), refetchInterval: 5000, enabled: !!activeStore } }
  );

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
    if (!window.confirm("Apakah Anda yakin ingin keluar dari aplikasi?")) return;
    queryClient.clear(); // Bersihkan cache React Query
    await supabase.auth.signOut();
    setLocation('/login');
  };

  const handleAddStore = async () => {
    if (!newStoreName.trim()) return toast({ title: 'Peringatan', description: 'Nama toko tidak boleh kosong.', variant: 'destructive' });
    setIsAddingStore(true);
    try {
      await customFetch('/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newStoreName.trim() }),
      });
      toast({ title: 'Sukses', description: 'Toko berhasil ditambahkan.' });
      setIsAddStoreOpen(false);
      setNewStoreName('');
      fetchStores(); // Refresh daftar toko langsung dari Supabase
    } catch (error: any) {
      toast({ title: 'Gagal', description: error.message || 'Gagal menambah toko', variant: 'destructive' });
    } finally {
      setIsAddingStore(false);
    }
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
    setTimeout(() => qtyInputRef.current?.focus(), 100);
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
    if (!selectedProduct) return toast({ title: 'Perhatian', description: 'Pilih produk terlebih dahulu.', variant: 'destructive' });
    
    const dQty = parseQty(displayQuantity);
    const sQty = parseQty(secondaryDisplayQuantity);
    const wQty = parseQty(warehouseQuantity);

    if (dQty === 0 && sQty === 0 && wQty === 0) return toast({ title: 'Perhatian', description: 'Isi minimal satu jumlah stok.', variant: 'destructive' });

    setCart(prevCart => {
      const existingIndex = prevCart.findIndex(item => item.product.barcode === selectedProduct.barcode);
      if (existingIndex >= 0) {
        const newCart = [...prevCart];
        newCart[existingIndex] = {
          ...newCart[existingIndex],
          displayQuantity: newCart[existingIndex].displayQuantity + dQty,
          secondaryDisplayQuantity: newCart[existingIndex].secondaryDisplayQuantity + sQty,
          warehouseQuantity: newCart[existingIndex].warehouseQuantity + wQty,
        };
        return newCart;
      }
      return [...prevCart, { product: selectedProduct, displayQuantity: dQty, secondaryDisplayQuantity: sQty, warehouseQuantity: wQty }];
    });

    setSelectedProduct(null); setSearchQuery(''); setDisplayQuantity(''); setSecondaryDisplayQuantity(''); setWarehouseQuantity('');
    toast({ title: 'Berhasil', description: 'Ditambahkan ke keranjang.' });
  };

  const updateCartQty = (index: number, field: keyof Omit<CartItem, 'product'>, delta: number) => {
    setCart(prevCart => {
      const newCart = [...prevCart];
      const newValue = Math.max(0, newCart[index][field] + delta);
      newCart[index][field] = newValue;
      
      if (newCart[index].displayQuantity === 0 && newCart[index].secondaryDisplayQuantity === 0 && newCart[index].warehouseQuantity === 0) {
        newCart.splice(index, 1);
      }
      return newCart;
    });
  };

  const handleSubmitAll = async () => {
    if (!activeStore || cart.length === 0) return;
    setIsSaving(true);
    let successCount = 0;
    let failedCount = 0;
    const isAdjustment = transaction.includes('Koreksi');

    for (const item of cart) {
      try {
        await submitMutation.mutateAsync({ data: {
          clientId: globalThis.crypto.randomUUID(), 
          store: activeStore, 
          transaction, 
          product: item.product.name,
          quantity: item.displayQuantity + item.secondaryDisplayQuantity + item.warehouseQuantity,
          barcode: item.product.barcode, 
          displayQuantity: item.displayQuantity,
          secondaryDisplayQuantity: item.secondaryDisplayQuantity, 
          warehouseQuantity: item.warehouseQuantity,
          ...(isAdjustment ? { sourceType: 'adjustment' as const } : {}),
        } as any });
        successCount++;
      } catch (error) {
        console.error("Gagal simpan item:", item.product.name, error);
        failedCount++;
      }
    }

    setIsSaving(false);

    if (failedCount === 0) {
      toast({ title: 'Berhasil', description: `${successCount} produk berhasil disimpan.` });
      setCart([]);
    } else {
      toast({ 
        title: 'Sebagian Gagal', 
        description: `${successCount} tersimpan, ${failedCount} gagal. Silakan cek jaringan Anda.`, 
        variant: 'destructive' 
      });
      setCart([]); 
    }
    
    queryClient.invalidateQueries({ queryKey: getListStockBalancesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSalesMonitorQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSalesActivityQueryKey() });
  };

  const selectedBalance = selectedProduct ? stockBalances.find(b => b.barcode === selectedProduct.barcode) : null;

  return (
    <div className="min-h-[100dvh] w-full bg-sky-50/50 dark:bg-slate-950 flex flex-col items-center pb-24">
      {/* HEADER BIRU MUDA */}
      <header className="w-full max-w-md bg-gradient-to-br from-sky-600 to-blue-700 text-white pt-12 pb-6 px-6 shadow-lg rounded-b-[2rem] mb-6 sticky top-0 z-20">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-3xl font-serif font-bold tracking-tight">Erlangga</h1>
            <p className="text-sky-100 text-sm mt-1">Sistem Pencatatan Stok</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 bg-red-500/90 hover:bg-red-600 active:scale-95 transition-all px-3 py-2 rounded-lg text-xs font-bold shadow-sm"
            >
              <LogOut size={14} /> Logout
            </button>
          </div>
        </div>
        
        {/* TOMBOL NAVIGASI */}
        <div className="flex gap-2">
          <Link href="/operasional" className="flex-1 bg-white/10 hover:bg-white/20 transition-colors rounded-xl py-2 text-center text-[10px] sm:text-xs font-semibold shadow-sm">Kunjungan SO</Link>
          <Link href="/dashboard" className="flex-1 bg-white/10 hover:bg-white/20 transition-colors rounded-xl py-2 text-center text-[10px] sm:text-xs font-semibold shadow-sm">Laporan</Link>
          
          <Link href="/subscription" className="flex-1 bg-gradient-to-r from-amber-300 to-yellow-400 hover:from-amber-400 hover:to-yellow-500 text-blue-900 rounded-xl py-2 text-center text-[10px] sm:text-xs font-bold shadow-md shadow-amber-500/30">Langganan 👑</Link>
        </div>
      </header>

      <main className="w-full max-w-md px-4 flex flex-col gap-5">
        
        {/* FORM INPUT & KERANJANG */}
        <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 shadow-sm rounded-2xl p-5">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              
              {/* DROPDOWN TOKO & TOMBOL TAMBAH */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-sky-700 dark:text-sky-500 uppercase tracking-wider flex items-center gap-1"><Box size={12} /> Toko</label>
                <div className="flex gap-1">
                  <select 
                    value={storeName} 
                    onChange={e => setStoreName(e.target.value)} 
                    disabled={isLoadingStores}
                    className="w-full px-2 py-2 bg-sky-50 dark:bg-slate-950 border border-sky-200 dark:border-slate-800 rounded-lg text-sm font-medium focus:ring-2 focus:ring-sky-500 outline-none appearance-none"
                  >
                    <option value="" disabled>{isLoadingStores ? 'Memuat toko...' : 'Pilih Toko...'}</option>
                    {dbStores.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button onClick={() => setIsAddStoreOpen(true)} className="flex-none px-2 bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-900/30 dark:text-sky-400 rounded-lg flex items-center justify-center transition-colors shadow-sm" title="Tambah Toko">
                    <Plus size={18} />
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-sky-700 dark:text-sky-500 uppercase tracking-wider flex items-center gap-1"><RefreshCw size={12} /> Transaksi</label>
                <select value={transaction} onChange={e => setTransaction(e.target.value)} className="w-full px-3 py-2 bg-sky-50 dark:bg-slate-950 border border-sky-200 dark:border-slate-800 rounded-lg text-sm font-medium focus:ring-2 focus:ring-sky-500 outline-none appearance-none">
                  {TRANSACTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1 relative" ref={searchContainerRef}>
              <label className="text-xs font-bold text-sky-700 dark:text-sky-500 uppercase tracking-wider flex items-center gap-1"><Search size={12} /> Cari Produk</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input type="text" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setSelectedProduct(null); setShowSearchResults(true); }} onFocus={() => setShowSearchResults(true)} placeholder="Ketik nama atau scan barcode..." className="w-full pl-9 pr-8 py-2.5 bg-sky-50 dark:bg-slate-950 border border-sky-200 dark:border-slate-800 rounded-lg text-sm font-medium focus:ring-2 focus:ring-sky-500 outline-none" />
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-sky-400" />
                  {searchQuery && <button onClick={() => { setSearchQuery(''); setSelectedProduct(null); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-sky-400 hover:text-sky-600"><X size={14} /></button>}
                </div>
                <button onClick={() => setIsScannerOpen(true)} className="flex-none px-3 bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-900/30 dark:text-sky-400 rounded-lg flex items-center justify-center transition-colors shadow-sm"><Camera size={20} /></button>
              </div>

              {showSearchResults && searchQuery && !selectedProduct && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-sky-100 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
                  {filteredProducts.length === 0 ? <div className="p-4 text-center text-sm text-slate-500">Produk tidak ditemukan.</div> : (
                    <ul className="max-h-60 overflow-y-auto">
                      {filteredProducts.map(p => (
                        <li key={p.barcode} onClick={() => handleSelectProduct(p)} className="px-4 py-3 border-b border-sky-50 dark:border-slate-700 last:border-0 hover:bg-sky-50 dark:hover:bg-slate-700 cursor-pointer flex flex-col">
                          <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">{p.name}</span>
                          <span className="text-xs text-sky-600 dark:text-sky-400 font-mono mt-0.5">{p.barcode}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {selectedProduct && (
              <div className="p-3 bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-800 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-2">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-bold text-sky-900 dark:text-sky-100">{selectedProduct.name}</p>
                    <p className="text-xs text-sky-600 dark:text-sky-400 font-mono">{selectedProduct.barcode}</p>
                  </div>
                  {selectedBalance && <span className="text-xs font-semibold bg-sky-200 dark:bg-sky-800 px-2 py-1 rounded-md text-sky-800 dark:text-sky-200 shadow-sm">Sisa: {selectedBalance.totalQuantity}</span>}
                </div>
                
                <div className="grid grid-cols-3 gap-2">
                  {[['display', 'Display', displayQuantity, setDisplayQuantity],['secondary', 'Secondary', secondaryDisplayQuantity, setSecondaryDisplayQuantity],['gudang', 'Gudang', warehouseQuantity, setWarehouseQuantity]].map(([key, label, val, setVal]: any) => (
                    <div key={key} className="space-y-1">
                      <label className="text-[10px] font-bold text-sky-700 dark:text-sky-300 text-center block">{label}</label>
                      <input 
                        type="number" 
                        min="0" 
                        placeholder="0" 
                        value={val} 
                        ref={key === 'display' ? qtyInputRef : undefined}
                        onChange={e => setVal(e.target.value)} 
                        className="w-full text-center py-2 bg-white dark:bg-slate-950 border border-sky-200 dark:border-sky-800 rounded-lg font-bold text-lg outline-none focus:ring-2 focus:ring-sky-500" 
                      />
                    </div>
                  ))}
                </div>
                <button onClick={handleAddToCart} className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm"><Plus size={16} /> Tambah ke Keranjang</button>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 shadow-sm rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100"><ShoppingCart size={18} className="text-sky-600" /> Keranjang</h2>
            <span className="text-xs font-bold bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 px-2.5 py-1 rounded-full">{cart.length} Item</span>
          </div>
          
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-sky-400/60">
              <ShoppingCart size={32} className="mb-2 opacity-30" />
              <p className="text-sm">Belum ada barang di keranjang.</p>
            </div>
          ) : (
            <div className="space-y-3 mb-5">
              {cart.map((item, idx) => (
                <div key={idx} className="bg-sky-50/50 dark:bg-slate-950 p-3 rounded-xl border border-sky-100 dark:border-slate-800 flex flex-col gap-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-sm text-slate-800 dark:text-slate-100">{item.product.name}</p>
                      <p className="text-[11px] text-sky-600 dark:text-sky-400 font-mono mt-0.5">{item.product.barcode}</p>
                    </div>
                    <button onClick={() => setCart(cart.filter((_, i) => i !== idx))} className="text-red-500 p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"><Trash2 size={16} /></button>
                  </div>
                  
                  <div className="flex items-center gap-2 mt-1">
                    {['displayQuantity', 'secondaryDisplayQuantity', 'warehouseQuantity'].map((field, i) => (
                      <div key={field} className="flex-1 flex flex-col items-center bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 rounded-lg p-1 shadow-sm">
                        <span className="text-[9px] font-bold text-sky-400 uppercase">{['Dsp', 'Sec', 'Gdg'][i]}</span>
                        <div className="flex items-center justify-between w-full mt-1">
                          <button onClick={() => updateCartQty(idx, field as any, -1)} className="p-1 text-sky-400 hover:text-sky-800"><Minus size={12} /></button>
                          <span className="font-bold text-sm">{(item as any)[field]}</span>
                          <button onClick={() => updateCartQty(idx, field as any, 1)} className="p-1 text-sky-400 hover:text-sky-800"><Plus size={12} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <button onClick={handleSubmitAll} disabled={isSaving || cart.length === 0} className="w-full py-3.5 bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 transition-all shadow-md">
            {isSaving ? 'Menyimpan Data...' : <><Send size={18} /> Simpan ke Database</>}
          </button>
        </div>

        <ProductManager products={products} onAdd={addProduct} onRemove={removeProduct} onUpdate={updateProduct} onReplace={replaceProducts} />

        {/* --- BAGIAN STOK PRODUK (SALDO) --- */}
        <section className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 shadow-sm rounded-2xl p-5">
          <h2 className="font-serif text-lg font-bold flex items-center gap-2 mb-4 text-slate-800 dark:text-slate-100">
            <Package size={18} className="text-sky-600" /> Stok Produk Saat Ini
          </h2>
          {stockBalances.length === 0 ? (
            <p className="text-center text-sm text-sky-500 py-4">Belum ada stok barang di toko ini.</p>
          ) : (
            <div className="space-y-2">
              {stockBalances.map((balance) => (
                <div key={`${balance.store}-${balance.barcode}`} className="flex items-center justify-between p-3 rounded-xl border border-sky-50 dark:border-slate-800 bg-sky-50/30 dark:bg-slate-950/50">
                  <div className="min-w-0 pr-2">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{balance.product}</p>
                    <p className="text-[11px] text-sky-500 font-mono mt-0.5">{balance.barcode}</p>
                  </div>
                  <span className="shrink-0 text-lg font-bold text-sky-700 dark:text-sky-400 bg-sky-100 dark:bg-sky-900/30 px-3 py-1 rounded-lg">
                    {balance.totalQuantity}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <BarcodeScanner isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScanSuccess={handleScanSuccess} />

      {/* MODAL TAMBAH TOKO BARU */}
      {isAddStoreOpen && (
        <div className="fixed inset-0 bg-sky-950/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in zoom-in-95">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4 border border-sky-100 dark:border-slate-800">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg flex items-center gap-2 text-sky-900 dark:text-sky-100"><Store size={18} /> Tambah Toko</h3>
              <button onClick={() => setIsAddStoreOpen(false)} className="text-sky-400 hover:text-sky-600"><X size={20} /></button>
            </div>
            <p className="text-xs text-sky-600">Tambahkan cabang atau toko baru untuk akun Anda.</p>
            <div>
              <label className="text-xs font-bold text-sky-700 uppercase mb-1 block">Nama Toko</label>
              <input 
                type="text" 
                value={newStoreName} 
                onChange={(e) => setNewStoreName(e.target.value)} 
                placeholder="Contoh: Cabang Dago" 
                className="w-full px-3 py-2 bg-sky-50 dark:bg-slate-950 border border-sky-200 dark:border-slate-800 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 outline-none" 
                autoFocus
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setIsAddStoreOpen(false)} className="flex-1 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-bold hover:bg-slate-200 transition-colors">Batal</button>
              <button onClick={handleAddStore} disabled={isAddingStore} className="flex-1 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-bold disabled:opacity-50 transition-colors shadow-sm">
                {isAddingStore ? 'Menyimpan...' : 'Simpan Toko'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}