import { useState, useMemo } from "react";
import { Link } from "wouter";
import { ArrowLeft, TrendingUp, PackageMinus, AlertCircle, Trash2 } from "lucide-react";
import { useStoreName } from "@/hooks/useStoreName";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/supabase";

type GroupedItem = {
  store: string;
  product: string;
  barcode: string;
  previousStock: number;
  restockQuantity: number;
  stockEntryAdjustment: number;
  currentStock: number;
  soldQuantity: number;
  latestVisitTime: number;
  entryIds: string[]; // Menggunakan string karena ID Supabase biasanya UUID
};

const getLocalDateString = (dateString: string) => {
  try {
    const d = new Date(dateString);
    return d.toLocaleDateString('en-CA'); 
  } catch {
    return new Date().toLocaleDateString('en-CA');
  }
};

export default function DailySalesReport() {
  const [storeName] = useStoreName();
  const activeStore = storeName.trim();
  const [visibleDatesCount, setVisibleDatesCount] = useState(1);
  
  const queryClient = useQueryClient();

  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setDate(today.getDate() - 30);
    return {
      from: lastMonth.toLocaleDateString('en-CA'),
      to: today.toLocaleDateString('en-CA'),
    };
  });

  // 1. AMBIL DATA LANGSUNG DARI SUPABASE
  const { data: rawEntries = [], isLoading: monitorLoading, isError } = useQuery({
    queryKey: ['salesMonitor', activeStore, dateRange.from, dateRange.to],
    queryFn: async () => {
      if (!activeStore) return [];

      // Ambil semua transaksi di toko ini pada rentang tanggal yang dipilih
      const { data, error } = await supabase
        .from('stock_entries') // <--- PASTIKAN NAMA TABEL INI SAMA DENGAN DI SUPABASE
        .select('*')
        .eq('store', activeStore)
        .gte('created_at', dateRange.from)
        .lte('created_at', dateRange.to + 'T23:59:59')
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    enabled: !!activeStore,
  });

  // 2. PROSES DATA MENTAH MENJADI LAPORAN (Grouping)
  const { groupedItems, summary } = useMemo(() => {
    const groups: Record<string, Record<string, GroupedItem>> = {};
    let totalSold = 0;
    let totalRestocked = 0;

    rawEntries.forEach((entry: any) => {
      const dateStr = getLocalDateString(entry.created_at);
      if (!groups[dateStr]) groups[dateStr] = {};
      
      const key = entry.barcode;
      if (!groups[dateStr][key]) {
        groups[dateStr][key] = {
          store: entry.store,
          product: entry.product,
          barcode: entry.barcode,
          previousStock: 0, // Bisa disesuaikan jika ada logika saldo awal
          restockQuantity: 0,
          stockEntryAdjustment: 0,
          currentStock: 0,
          soldQuantity: 0,
          latestVisitTime: new Date(entry.created_at).getTime(),
          entryIds: [],
        };
      }

      const qty = Number(entry.quantity) || 0;
      const item = groups[dateStr][key];

      // Kategorikan transaksi
      if (['Penjualan'].includes(entry.transaction)) {
        item.soldQuantity += qty;
        totalSold += qty;
      } else if (['Input Stok', 'Stock Awal', 'Pembelian', 'Retur'].includes(entry.transaction)) {
        item.restockQuantity += qty;
        totalRestocked += qty;
      } else if (entry.transaction.includes('Koreksi')) {
        item.stockEntryAdjustment += entry.transaction.includes('+') ? qty : -qty;
      }

      // Simpan ID untuk fitur hapus
      if (entry.id && !item.entryIds.includes(entry.id)) {
        item.entryIds.push(entry.id);
      }
      
      // Update waktu transaksi terakhir
      const entryTime = new Date(entry.created_at).getTime();
      if (entryTime >= item.latestVisitTime) {
        item.latestVisitTime = entryTime;
      }
    });

    const result: Record<string, GroupedItem[]> = {};
    Object.keys(groups).forEach(date => {
      result[date] = Object.values(groups[date]);
    });

    return { groupedItems: result, summary: { totalSold, totalRestocked } };
  }, [rawEntries]);

  const sortedDates = useMemo(() => {
    return Object.keys(groupedItems).sort((a, b) => b.localeCompare(a));
  }, [groupedItems]);

  const visibleDates = sortedDates.slice(0, visibleDatesCount);

  const formatDateIndo = (dateString: string) => {
    const d = new Date(`${dateString}T00:00:00`); 
    return d.toLocaleDateString("id-ID", { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  };

  // 3. FUNGSI HAPUS LANGSUNG KE SUPABASE
  const handleDeleteItem = async (item: GroupedItem) => {
    if (item.entryIds.length === 0) {
      alert("Gagal: Data ID tidak ditemukan.");
      return;
    }

    const confirmDelete = window.confirm(`Hapus semua data penjualan/stok untuk produk "${item.product}" pada tanggal ini?`);
    if (!confirmDelete) return;

    try {
      // Hapus semua baris transaksi yang berhubungan dengan item ini
      const { error } = await supabase
        .from('stock_entries')
        .delete()
        .in('id', item.entryIds);

      if (error) throw error;

      // Refresh data otomatis
      queryClient.invalidateQueries({ queryKey: ['salesMonitor'] });
      alert("Data berhasil dihapus!");
    } catch (error) {
      console.error("Gagal menghapus:", error);
      alert("Terjadi kesalahan saat menghapus data.");
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-950 flex flex-col items-center pb-12">
      <header className="w-full max-w-md bg-gradient-to-br from-sky-600 to-blue-700 text-white pt-10 pb-6 px-6 shadow-lg rounded-b-[2rem] mb-6 sticky top-0 z-20">
        <div className="flex justify-between items-start mb-2">
          <div>
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-100 hover:text-white mb-2 transition-colors">
              <ArrowLeft size={16} /> Kembali ke Input Stok
            </Link>
            <h1 className="text-2xl font-serif font-bold tracking-tight">Laporan Penjualan</h1>
            <h2 className="text-sm text-sky-100 font-medium">
              {activeStore ? `Toko: ${activeStore}` : "Pilih Toko di Menu Utama"}
            </h2>
          </div>
        </div>
      </header>

      <main className="w-full max-w-md px-4 flex-1 flex flex-col gap-6">
        {/* Filter Tanggal */}
        <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 shadow-sm rounded-2xl p-4 flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-semibold text-sky-700 dark:text-sky-500 block mb-1">Dari</label>
            <input
              type="date"
              value={dateRange.from}
              max={dateRange.to} 
              onChange={(e) => {
                setDateRange({ ...dateRange, from: e.target.value });
                setVisibleDatesCount(1);
              }}
              className="w-full px-3 py-2 bg-sky-50 dark:bg-slate-950 border border-sky-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-sky-500 text-slate-800 dark:text-slate-100"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-semibold text-sky-700 dark:text-sky-500 block mb-1">Sampai</label>
            <input
              type="date"
              value={dateRange.to}
              min={dateRange.from} 
              onChange={(e) => {
                setDateRange({ ...dateRange, to: e.target.value });
                setVisibleDatesCount(1);
              }}
              className="w-full px-3 py-2 bg-sky-50 dark:bg-slate-950 border border-sky-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-sky-500 text-slate-800 dark:text-slate-100"
            />
          </div>
        </div>

        {isError && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl p-4 flex items-center gap-3">
            <AlertCircle size={20} />
            <p className="text-sm font-medium">Gagal memuat data. Periksa koneksi internet Anda.</p>
          </div>
        )}

        {/* Ringkasan Penjualan */}
        {monitorLoading ? (
           <div className="h-32 animate-pulse rounded-2xl bg-sky-100 dark:bg-slate-800" />
        ) : (
          <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 shadow-sm rounded-2xl p-5">
            <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <TrendingUp size={18} className="text-sky-600" /> Ringkasan
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-sky-50 dark:bg-sky-900/20 rounded-xl p-3 border border-sky-100 dark:border-sky-800">
                <p className="text-xs text-sky-600 dark:text-sky-400">Total Terjual</p>
                <p className="text-2xl font-bold text-sky-700 dark:text-sky-300">{summary.totalSold}</p>
              </div>
              <div className="bg-sky-50 dark:bg-sky-900/20 rounded-xl p-3 border border-sky-100 dark:border-sky-800">
                <p className="text-xs text-sky-600 dark:text-sky-400">Total Restock</p>
                <p className="text-2xl font-bold text-sky-700 dark:text-sky-300">{summary.totalRestocked}</p>
              </div>
            </div>
          </div>
        )}

        {/* Daftar Barang */}
        <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 shadow-sm rounded-2xl p-5">
          <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <PackageMinus size={18} className="text-sky-600" /> Aktivitas Stok & Penjualan
          </h3>
          
          {monitorLoading ? (
            <div className="space-y-3">
              <div className="h-14 animate-pulse rounded-xl bg-sky-100 dark:bg-slate-800" />
              <div className="h-14 animate-pulse rounded-xl bg-sky-100 dark:bg-slate-800" />
            </div>
          ) : sortedDates.length === 0 ? (
            <div className="text-center py-8 text-sky-600 dark:text-sky-400 border border-dashed border-sky-200 dark:border-slate-700 rounded-xl bg-sky-50/50 dark:bg-slate-950/50">
              Belum ada aktivitas penjualan/stok pada periode ini. <br/>
              <span className="text-xs">(Lakukan Kunjungan SO atau input Restock terlebih dahulu).</span>
            </div>
          ) : (
            <>
              <div className="space-y-8">
                {visibleDates.map((date) => (
                  <div key={date}>
                    <div className="sticky top-[80px] z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm py-2 mb-3 border-b border-sky-100 dark:border-slate-800">
                      <h4 className="font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wide text-xs flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-sky-500 block"></span>
                        {formatDateIndo(date)}
                      </h4>
                    </div>

                    <ul className="space-y-4">
                      {groupedItems[date].map((item, index) => (
                        <li key={`${item.barcode}-${index}`} className="border border-sky-100 dark:border-slate-800 rounded-xl p-4 shadow-sm bg-white dark:bg-slate-900 hover:border-sky-300 dark:hover:border-sky-700 transition-colors">
                          
                          <div className="flex justify-between items-start mb-3">
                            <div className="pr-2">
                              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{item.product}</p>
                              <p className="text-[11px] text-sky-600 dark:text-sky-400 font-mono">{item.barcode}</p>
                            </div>
                            
                            <div className="text-right shrink-0 flex items-start gap-2">
                              <div>
                                <p className="text-[10px] uppercase tracking-wider font-semibold text-sky-600 dark:text-sky-400">Terjual</p>
                                <p className="text-2xl font-bold text-sky-600 dark:text-sky-400">
                                  {item.soldQuantity} <span className="text-xs font-normal text-sky-500/70">pcs</span>
                                </p>
                              </div>
                              <button
                                onClick={() => handleDeleteItem(item)}
                                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                                title="Hapus Data"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-1 bg-sky-50/50 dark:bg-slate-950 rounded-lg p-2 text-center">
                            <div>
                              <p className="text-[10px] text-slate-500">Stok Masuk</p>
                              <p className="text-sm font-semibold text-emerald-600">+{item.restockQuantity}</p>
                            </div>
                            <div className="border-x border-sky-100 dark:border-slate-800">
                              <p className="text-[10px] text-slate-500">Koreksi</p>
                              <p className="text-sm font-semibold text-amber-600">{item.stockEntryAdjustment > 0 ? `+${item.stockEntryAdjustment}` : item.stockEntryAdjustment}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500">Total Transaksi</p>
                              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{item.entryIds.length}x</p>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 mt-6 border-t border-sky-100 dark:border-slate-800 pt-4">
                {visibleDatesCount > 1 && (
                  <button
                    type="button"
                    onClick={() => setVisibleDatesCount((prev) => Math.max(1, prev - 1))}
                    className="flex-1 py-2.5 text-sm font-semibold text-slate-500 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    Muat Lebih Sedikit
                  </button>
                )}
                
                {visibleDatesCount < sortedDates.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleDatesCount((prev) => prev + 1)}
                    className="flex-1 py-2.5 text-sm font-semibold text-sky-600 border border-sky-300 dark:border-sky-700 rounded-xl hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors"
                  >
                    Muat Tanggal Sebelumnya
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}