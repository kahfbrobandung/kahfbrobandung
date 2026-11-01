import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, BarChart3, Calendar, Store, TrendingUp } from "lucide-react";
import { useGetDailySales, useGetSalesMonitor } from "@workspace/api-client-react";
import { useStoreName } from "@/hooks/useStoreName";

export default function DailySalesReport() {
  const [storeName] = useStoreName();
  const activeStore = storeName.trim();
  const [dateRange, setDateRange] = useState({
    from: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split("T")[0],
    to: new Date().toISOString().split("T")[0],
  });

  // Mengambil data penjualan harian dari API
  const { data: dailySales, isLoading: salesLoading } = useGetDailySales({
    from: dateRange.from,
    to: dateRange.to,
    store: activeStore || undefined,
  });

  // Mengambil data monitor penjualan (agregat)
  const { data: salesMonitor, isLoading: monitorLoading } = useGetSalesMonitor({
    from: dateRange.from,
    to: dateRange.to,
    store: activeStore || undefined,
  });

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
              onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
              className="w-full px-3 py-2 bg-background border border-border rounded-xl text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Sampai</label>
            <input
              type="date"
              value={dateRange.to}
              onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
              className="w-full px-3 py-2 bg-background border border-border rounded-xl text-sm"
            />
          </div>
        </div>

        {/* Ringkasan Penjualan */}
        {salesMonitor && (
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
              <div className="bg-primary/5 rounded-xl p-3 border border-primary/10">
                <p className="text-xs text-muted-foreground">Toko Aktif</p>
                <p className="text-2xl font-bold text-primary">{salesMonitor.summary.activeStores}</p>
              </div>
              <div className="bg-primary/5 rounded-xl p-3 border border-primary/10">
                <p className="text-xs text-muted-foreground">SKU Terpantau</p>
                <p className="text-2xl font-bold text-primary">{salesMonitor.summary.trackedSkus}</p>
              </div>
            </div>
          </div>
        )}

        {/* Daftar Transaksi Penjualan */}
        <div className="bg-card border border-border shadow-sm rounded-2xl p-5">
          <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2">
            <BarChart3 size={18} className="text-primary" /> Transaksi Harian
          </h3>
          
          {salesLoading ? (
            <div className="space-y-3">
              <div className="h-14 animate-pulse rounded-xl bg-muted" />
              <div className="h-14 animate-pulse rounded-xl bg-muted" />
            </div>
          ) : !dailySales || dailySales.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border border-dashed rounded-xl">
              Belum ada transaksi penjualan pada periode ini.
            </div>
          ) : (
            <ul className="space-y-3">
              {dailySales.map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="text-sm font-semibold">{sale.product}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(sale.createdAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <span className="font-mono font-bold text-primary">-{sale.quantity}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
