import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, TrendingUp, PackageMinus } from "lucide-react";
import { useGetSalesMonitor } from "@workspace/api-client-react";
import { useStoreName } from "@/hooks/useStoreName";

export default function DailySalesReport() {
  const [storeName] = useStoreName();
  const activeStore = storeName.trim();
  
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
            <ul className="space-y-3">
              {soldItems.map((item, index) => (
                <li key={`${item.barcode}-${index}`} className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="text-sm font-semibold">{item.product}</p>
                    <p className="text-xs text-muted-foreground font-mono">{item.barcode}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      SO Terakhir: {new Date(item.currentVisitAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  <span className="font-mono font-bold text-destructive text-lg">-{item.soldQuantity}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
