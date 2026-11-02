import { useState, useMemo } from "react";
import { Link } from "wouter";
import { ArrowLeft, TrendingUp, PackageMinus } from "lucide-react";
import { useGetSalesMonitor } from "@workspace/api-client-react";
import { useStoreName } from "@/hooks/useStoreName";

export default function DailySalesReport() {
  const [storeName] = useStoreName();
  const activeStore = storeName.trim();
  
  // STATE UNTUK PAGINATION LAPORAN BERDASARKAN TANGGAL
  const [visibleDatesCount, setVisibleDatesCount] = useState(1);

  // Default filter 30 hari terakhir
  const [dateRange, setDateRange] = useState({
    from: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split("T")[0],
    to: new Date().toISOString().split("T")[0],
  });

  // Ambil data perhitungan otomatis dari Kunjungan SO
  const { data: salesMonitor, isLoading: monitorLoading } = useGetSalesMonitor({
    from: dateRange.from,
    to: dateRange.to,
    store: activeStore || undefined,
  });

  // Filter hanya barang yang benar-benar terjual (di atas 0)
  const soldItems = salesMonitor?.calculations?.filter((item) => item.soldQuantity > 0) || [];

  // 1. Kelompokkan barang berdasarkan tanggal SO
  const groupedItems = useMemo(() => {
    const groups: Record<string, typeof soldItems> = {};
    soldItems.forEach((item) => {
      // Ambil format YYYY-MM-DD untuk sorting
      const dateStr = new Date(item.currentVisitAt).toISOString().split("T")[0];
      if (!groups[dateStr]) groups[dateStr] = [];
      groups[dateStr].push(item);
    });
    return groups;
  }, [soldItems]);

  // 2. Ambil semua tanggal unik dan urutkan dari yang terbaru
  const sortedDates = useMemo(() => {
    return Object.keys(groupedItems).sort((a, b) => b.localeCompare(a));
  }, [groupedItems]);

  // 3. Potong tanggal yang mau ditampilkan
  const visibleDates = sortedDates.slice(0, visibleDatesCount);

  return (
    <div className="min-h-[100dvh] w-full bg-background flex flex-col items-center pb-12">
      <header className="w-full max-w-md bg-primary text-primary-foreground pt-10 pb-6 px-6 shadow-md rounded-b-3xl mb-6 sticky top-0 z-10">
        <div className="flex justify-between items-start mb-2">
          <div>
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-foreground/80 hover:text-primary-foreground mb-2">
              <ArrowLeft size={16} /> Kembali ke Input Stok
            </Link>
            <h1 className="text-2xl font-serif font-bold tracking-tight">Laporan Penjualan</h1>
            <h2 className="text-sm text-primary-foreground/80 font-medium">
              {activeStore ? `Toko: ${activeStore}` : "Semua Toko"}
            </h2>
          </div>
        </div>
      </header>

      <main className="w-full max-w-md px-4 flex-1 flex flex-col gap-6">
        {/* Filter Tanggal */}
        <div className="bg-card border border-border shadow-sm rounded-2xl p-4 flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Dari</label>
            <input
              type="date"
              value={dateRange.from}
              onChange={(e) => {
                setDateRange({ ...dateRange, from: e.target.value });
                setVisibleDatesCount(1); // Reset tampilan ke tanggal terbaru
              }}
              className="w-full px-3 py-2 bg-background border border-border rounded-xl text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Sampai</label>
            <input
              type="date"
              value={dateRange.to}
              onChange={(e) => {
                setDateRange({ ...dateRange, to: e.target.value });
                setVisibleDatesCount(1); // Reset tampilan ke tanggal terbaru
              }}
              className="w-full px-3 py-2 bg-background border border-border rounded-xl text-sm"
            />
          </div>
        </div>

        {/* Ringkasan Penjualan */}
        {monitorLoading ? (
           <div className="h-32 animate-pulse rounded-2xl bg-muted" />
        ) : salesMonitor ? (
          <div className="bg-card border border-border shadow-sm rounded-2xl p-5">
            <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2">
              <TrendingUp size={18} className="text-primary" /> Ringkasan
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-primary/5 rounded-xl p-3 border border-primary/10">
                <p className="text-xs text-muted-foreground">Total Terjual</p>
                <p className="text-2xl font-bold text-primary">{salesMonitor.summary.totalSold}</p>
              </div>
              <div className="bg-primary/5 rounded-xl p-3 border border-primary/10">
                <p className="text-xs text-muted-foreground">Total Restock</p>
                <p className="text-2xl font-bold text-primary">{salesMonitor.summary.totalRestocked}</p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Daftar Barang Terjual */}
        <div className="bg-card border border-border shadow-sm rounded-2xl p-5">
          <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2">
            <PackageMinus size={18} className="text-primary" /> Daftar Barang Terjual
          </h3>
          
          {monitorLoading ? (
            <div className="space-y-3">
              <div className="h-14 animate-pulse rounded-xl bg-muted" />
              <div className="h-14 animate-pulse rounded-xl bg-muted" />
            </div>
          ) : soldItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border border-dashed rounded-xl">
              Belum ada perhitungan penjualan pada periode ini. <br/>
              <span className="text-xs">(Pastikan ada minimal 2x Kunjungan SO untuk produk yang sama di toko ini).</span>
            </div>
          ) : (
            <>
              <div className="space-y-8">
                {visibleDates.map((date) => (
                  <div key={date}>
                    {/* Header Tanggal */}
                    <div className="sticky top-[80px] z-10 bg-card/95 backdrop-blur-sm py-2 mb-3 border-b border-border/50">
                      <h4 className="font-bold text-gray-800 uppercase tracking-wide text-xs flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-primary block"></span>
                        {new Date(date).toLocaleDateString("id-ID", { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                      </h4>
                    </div>

                    {/* List Barang di Tanggal Tersebut */}
                    <ul className="space-y-4">
                      {groupedItems[date].map((item, index) => (
                        <li key={`${item.barcode}-${index}`} className="border border-border rounded-xl p-4 shadow-sm bg-card hover:border-primary/30 transition-colors">
                          
                          {/* Baris Atas: Nama Produk & Angka Terjual */}
                          <div className="flex justify-between items-start mb-3">
                            <div className="pr-2">
                              <p className="text-sm font-bold text-foreground">{item.product}</p>
                              <p className="text-[11px] text-muted-foreground font-mono">{item.barcode}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Terjual</p>
                              <p className="text-2xl font-bold text-emerald-600">
                                {item.soldQuantity} <span className="text-xs font-normal text-emerald-600/70">pcs</span>
                              </p>
                            </div>
                          </div>

                          {/* Baris Bawah: Rincian Hitungan */}
                          <div className="grid grid-cols-3 gap-1 bg-muted/50 rounded-lg p-2 text-center">
                            <div>
                              <p className="text-[10px] text-muted-foreground">Stok Awal</p>
                              <p className="text-sm font-semibold">{item.previousStock}</p>
                            </div>
                            <div className="border-x border-border/50">
                              <p className="text-[10px] text-muted-foreground">Stok Masuk</p>
                              <p className="text-sm font-semibold text-blue-600">+{item.restockQuantity + item.stockEntryAdjustment}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground">Stok Akhir (SO)</p>
                              <p className="text-sm font-semibold">{item.currentStock}</p>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* TOMBOL PAGINATION LAPORAN (BERDASARKAN TANGGAL) */}
              <div className="flex gap-2 mt-6 border-t border-border pt-4">
                {visibleDatesCount > 1 && (
                  <button
                    type="button"
                    onClick={() => setVisibleDatesCount((prev) => Math.max(1, prev - 1))}
                    className="flex-1 py-2.5 text-sm font-semibold text-muted-foreground border border-border rounded-xl hover:bg-muted/50 transition-colors"
                  >
                    Muat Lebih Sedikit
                  </button>
                )}
                
                {visibleDatesCount < sortedDates.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleDatesCount((prev) => prev + 1)}
                    className="flex-1 py-2.5 text-sm font-semibold text-primary border border-primary/30 rounded-xl hover:bg-primary/5 transition-colors"
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
