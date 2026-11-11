import { useState, useMemo } from "react";
import { Link } from "wouter";
import { ArrowLeft, TrendingUp, PackageMinus, AlertCircle } from "lucide-react";
import { useGetSalesMonitor } from "@workspace/api-client-react";
import { useStoreName } from "@/hooks/useStoreName";

// Tipe data untuk memastikan TypeScript aman
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

  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setDate(today.getDate() - 30);
    return {
      from: lastMonth.toLocaleDateString('en-CA'),
      to: today.toLocaleDateString('en-CA'),
    };
  });

  // Tambahkan isError untuk menangkap jika API gagal (misal Vercel timeout)
  const { data: salesMonitor, isLoading: monitorLoading, isError } = useGetSalesMonitor({
    from: dateRange.from,
    to: dateRange.to,
    store: activeStore || undefined,
  });

  // PERBAIKAN 1: Jangan buang barang yang tidak terjual (0) jika ada Stok Masuk (Restock)
  const activeItems = salesMonitor?.calculations?.filter(
    (item) => item.soldQuantity > 0 || item.restockQuantity > 0 || item.stockEntryAdjustment !== 0
  ) || [];

  const groupedItems = useMemo(() => {
    const groups: Record<string, Record<string, GroupedItem>> = {};
    
    const sortedItems = [...activeItems].sort((a, b) => 
      new Date(a.currentVisitAt).getTime() - new Date(b.currentVisitAt).getTime()
    );

    sortedItems.forEach((item) => {
      const dateStr = getLocalDateString(item.currentVisitAt);
      
      if (!groups[dateStr]) groups[dateStr] = {};
      
      const key = item.barcode;
      if (!groups[dateStr][key]) {
        groups[dateStr][key] = {
          store: item.store,
          product: item.product,
          barcode: item.barcode,
          previousStock: item.previousStock,
          restockQuantity: 0,
          stockEntryAdjustment: 0,
          currentStock: item.currentStock,
          soldQuantity: 0,
          latestVisitTime: 0,
        };
      }
      
      // PERBAIKAN 2: Pastikan data berupa Number agar tidak terjadi NaN (Not a Number)
      groups[dateStr][key].soldQuantity += Number(item.soldQuantity);
      groups[dateStr][key].restockQuantity += Number(item.restockQuantity);
      groups[dateStr][key].stockEntryAdjustment += Number(item.stockEntryAdjustment);
      
      const visitTime = new Date(item.currentVisitAt).getTime();
      if (visitTime >= groups[dateStr][key].latestVisitTime) {
        groups[dateStr][key].currentStock = Number(item.currentStock);
        groups[dateStr][key].previousStock = Number(item.previousStock);
        groups[dateStr][key].latestVisitTime = visitTime;
      }
    });
    
    const result: Record<string, GroupedItem[]> = {};
    Object.keys(groups).forEach(date => {
      result[date] = Object.values(groups[date]);
    });
    return result;
  }, [activeItems]);

  const sortedDates = useMemo(() => {
    return Object.keys(groupedItems).sort((a, b) => b.localeCompare(a));
  }, [groupedItems]);

  const visibleDates = sortedDates.slice(0, visibleDatesCount);

  // Helper untuk format tanggal aman dari timezone bug
  const formatDateIndo = (dateString: string) => {
    const d = new Date(`${dateString}T00:00:00`); // Paksa waktu lokal, bukan UTC
    return d.toLocaleDateString("id-ID", { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
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
              {activeStore ? `Toko: ${activeStore}` : "Semua Toko"}
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

        {/* Tampilan Jika API Error */}
        {isError && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl p-4 flex items-center gap-3">
            <AlertCircle size={20} />
            <p className="text-sm font-medium">Gagal memuat data. Koneksi ke server terputus.</p>
          </div>
        )}

        {/* Ringkasan Penjualan */}
        {monitorLoading ? (
           <div className="h-32 animate-pulse rounded-2xl bg-sky-100 dark:bg-slate-800" />
        ) : salesMonitor ? (
          <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 shadow-sm rounded-2xl p-5">
            <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <TrendingUp size={18} className="text-sky-600" /> Ringkasan
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-sky-50 dark:bg-sky-900/20 rounded-xl p-3 border border-sky-100 dark:border-sky-800">
                <p className="text-xs text-sky-600 dark:text-sky-400">Total Terjual</p>
                <p className="text-2xl font-bold text-sky-700 dark:text-sky-300">{salesMonitor?.summary?.totalSold ?? 0}</p>
              </div>
              <div className="bg-sky-50 dark:bg-sky-900/20 rounded-xl p-3 border border-sky-100 dark:border-sky-800">
                <p className="text-xs text-sky-600 dark:text-sky-400">Total Restock</p>
                <p className="text-2xl font-bold text-sky-700 dark:text-sky-300">{salesMonitor?.summary?.totalRestocked ?? 0}</p>
              </div>
            </div>
          </div>
        ) : null}

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
          ) : activeItems.length === 0 ? (
            <div className="text-center py-8 text-sky-600 dark:text-sky-400 border border-dashed border-sky-200 dark:border-slate-700 rounded-xl bg-sky-50/50 dark:bg-slate-950/50">
              Belum ada aktivitas penjualan/stok pada periode ini. <br/>
              <span className="text-xs">(Lakukan Kunjungan SO atau input Restock terlebih dahulu).</span>
            </div>
          ) : (
            <>
              <div className="space-y-8">
                {visibleDates.map((date) => (
                  <div key={date}>
                    {/* Header Tanggal */}
                    <div className="sticky top-[80px] z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm py-2 mb-3 border-b border-sky-100 dark:border-slate-800">
                      <h4 className="font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wide text-xs flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-sky-500 block"></span>
                        {formatDateIndo(date)}
                      </h4>
                    </div>

                    {/* List Barang */}
                    <ul className="space-y-4">
                      {groupedItems[date].map((item, index) => (
                        <li key={`${item.barcode}-${index}`} className="border border-sky-100 dark:border-slate-800 rounded-xl p-4 shadow-sm bg-white dark:bg-slate-900 hover:border-sky-300 dark:hover:border-sky-700 transition-colors">
                          
                          <div className="flex justify-between items-start mb-3">
                            <div className="pr-2">
                              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{item.product}</p>
                              <p className="text-[11px] text-sky-600 dark:text-sky-400 font-mono">{item.barcode}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[10px] uppercase tracking-wider font-semibold text-sky-600 dark:text-sky-400">Terjual</p>
                              <p className="text-2xl font-bold text-sky-600 dark:text-sky-400">
                                {item.soldQuantity} <span className="text-xs font-normal text-sky-500/70">pcs</span>
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-1 bg-sky-50/50 dark:bg-slate-950 rounded-lg p-2 text-center">
                            <div>
                              <p className="text-[10px] text-slate-500">Stok Awal</p>
                              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{item.previousStock}</p>
                            </div>
                            <div className="border-x border-sky-100 dark:border-slate-800">
                              <p className="text-[10px] text-slate-500">Stok Masuk</p>
                              {/* Tampilkan Restock murni tanpa adjustment yang membingungkan */}
                              <p className="text-sm font-semibold text-sky-600">+{item.restockQuantity}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500">Stok Akhir (SO)</p>
                              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{item.currentStock}</p>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* TOMBOL PAGINATION */}
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