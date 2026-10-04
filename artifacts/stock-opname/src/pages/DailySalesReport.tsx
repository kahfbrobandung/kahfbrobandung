import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  getGetDailySalesQueryKey,
  getGetSalesMonitorQueryKey,
  getListStoresQueryKey,
  useGetDailySales,
  useGetSalesMonitor,
  useListStores,
  type GetDailySalesParams,
  type GetSalesMonitorParams,
} from "@workspace/api-client-react";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, CalendarDays, ChartNoAxesCombined, CircleAlert, Clock3, RefreshCw } from "lucide-react";

const number = (value: number) => new Intl.NumberFormat("id-ID").format(value);
const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
  }).format(date);
};
const timestamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short",
  }).format(date);
};
function jakartaDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}-${parts.find(p => p.type === "day")?.value}`;
}
function shiftDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function metric(value: number) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
}

export default function DailySalesReport() {
  const today = useMemo(() => jakartaDate(new Date()), []);
  const [from, setFrom] = useState(() => shiftDate(jakartaDate(new Date()), -30));
  const [to, setTo] = useState(today);
  const [selectedStore, setSelectedStore] = useState("");
  const validRange = Boolean(from && to && from <= to);
  const storesQuery = useListStores({ query: { queryKey: getListStoresQueryKey(), staleTime: 300_000 } });
  const monitorParams: GetSalesMonitorParams = useMemo(() => ({
    from, to, ...(selectedStore ? { store: selectedStore } : {}),
  }), [from, to, selectedStore]);
  const legacyParams: GetDailySalesParams = useMemo(() => ({
    from, to, limit: 5000, ...(selectedStore ? { store: selectedStore } : {}),
  }), [from, to, selectedStore]);
  const monitor = useGetSalesMonitor(monitorParams, {
    query: { queryKey: getGetSalesMonitorQueryKey(monitorParams), enabled: validRange, staleTime: 30_000 },
  });
  const legacy = useGetDailySales(legacyParams, {
    query: { queryKey: getGetDailySalesQueryKey(legacyParams), enabled: validRange, staleTime: 30_000 },
  });
  const calculations = monitor.data?.calculations ?? [];
  const dailyTrend = monitor.data?.dailyTrend ?? [];
  const derivedTotal = calculations.reduce((sum, row) => sum + Math.max(0, row.soldQuantity), 0);
  const varianceCount = calculations.filter(row => row.hasStockVariance).length;
  const refresh = () => { void monitor.refetch(); void legacy.refetch(); };

  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-7 lg:px-10">
        <header className="mb-7 flex flex-col gap-5 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/" className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground transition hover:text-primary" data-testid="link-back-stock">
              <ArrowLeft className="h-4 w-4" /> Beranda stok
            </Link>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><ChartNoAxesCombined className="h-5 w-5" /></span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#967844]">Rekonsiliasi stok</p>
                <h1 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">Monitor penjualan</h1>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Penjualan otomatis dihitung dari selisih dua kunjungan fisik, disesuaikan barang masuk dan koreksi stok pada interval tersebut.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/operasional" className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold transition hover:bg-muted" data-testid="link-operations">
              Catat operasional
            </Link>
            <button type="button" onClick={refresh} disabled={!validRange || monitor.isFetching || legacy.isFetching} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50" data-testid="button-refresh-daily-sales">
              <RefreshCw className={`h-4 w-4 ${monitor.isFetching || legacy.isFetching ? "animate-spin" : ""}`} /> Segarkan
            </button>
          </div>
        </header>

        <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5" aria-label="Filter laporan">
          <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-muted-foreground">
            <CalendarDays className="h-4 w-4 text-primary" /> Periode audit <span className="ml-auto font-mono text-[10px] font-medium tracking-normal">WIB · Asia/Jakarta</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_auto] lg:items-end">
            <label className="text-xs font-semibold">Dari tanggal
              <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-normal focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15" data-testid="input-sales-from" />
            </label>
            <label className="text-xs font-semibold">Sampai tanggal
              <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-normal focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15" data-testid="input-sales-to" />
            </label>
            <label className="text-xs font-semibold">Toko
              <select value={selectedStore} onChange={e => setSelectedStore(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-normal focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15" data-testid="select-sales-store">
                <option value="">Semua toko</option>
                {(storesQuery.data ?? []).map(store => <option key={store.name} value={store.name}>{store.name}</option>)}
              </select>
            </label>
            <div className="rounded-xl bg-muted/70 px-4 py-2.5 text-xs text-muted-foreground"><span className="block font-semibold text-foreground">{selectedStore || "Semua toko"}</span><span>{from} — {to}</span></div>
          </div>
          {!validRange && <p className="mt-3 text-sm text-destructive" role="alert" data-testid="status-invalid-date-range">Tanggal awal harus sebelum atau sama dengan tanggal akhir.</p>}
        </section>

        {!validRange ? null : monitor.isError ? (
          <section className="mb-5 rounded-2xl border border-destructive/25 bg-destructive/5 p-8 text-center" role="alert" data-testid="status-monitor-error">
            <CircleAlert className="mx-auto h-8 w-8 text-destructive" /><p className="mt-3 font-semibold">Perhitungan stok belum dapat dimuat.</p>
            <button type="button" onClick={() => monitor.refetch()} className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" data-testid="button-retry-monitor">Coba lagi</button>
          </section>
        ) : monitor.isLoading ? (
          <section className="mb-5 grid gap-3 sm:grid-cols-3" aria-label="Memuat ringkasan"><div className="h-28 animate-pulse rounded-2xl bg-muted"/><div className="h-28 animate-pulse rounded-2xl bg-muted"/><div className="h-28 animate-pulse rounded-2xl bg-muted"/></section>
        ) : (
          <>
            <section className="mb-5 grid gap-3 sm:grid-cols-3" aria-label="Ringkasan penjualan otomatis">
              <div className="relative overflow-hidden rounded-2xl bg-primary p-5 text-primary-foreground sm:p-6">
                <span className="absolute -right-3 -top-5 font-mono text-8xl font-bold text-white/[.07]">Σ</span>
                <p className="text-[10px] font-bold uppercase tracking-[.17em] text-primary-foreground/70">Terjual · otomatis</p>
                <p className="mt-2 font-mono text-4xl font-semibold tracking-tight" data-testid="text-derived-sales-total">{metric(derivedTotal)}<span className="ml-2 text-sm font-medium">unit</span></p>
                <p className="mt-2 text-xs text-primary-foreground/70">Dihitung dari kunjungan fisik, bukan input Penjualan manual.</p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                <p className="text-[10px] font-bold uppercase tracking-[.17em] text-muted-foreground">Perbandingan kunjungan</p>
                <p className="mt-2 font-mono text-4xl font-semibold tracking-tight text-foreground" data-testid="text-visit-comparison-count">{metric(monitor.data?.summary.visitComparisons ?? calculations.length)}</p>
                <p className="mt-2 text-xs text-muted-foreground">Interval toko dan SKU pada periode terpilih.</p>
              </div>
              <div className={`rounded-2xl border p-5 sm:p-6 ${varianceCount ? "border-amber-300 bg-amber-50/70" : "border-border bg-card"}`}>
                <p className="text-[10px] font-bold uppercase tracking-[.17em] text-muted-foreground">Perlu audit</p>
                <p className={`mt-2 font-mono text-4xl font-semibold tracking-tight ${varianceCount ? "text-amber-800" : "text-foreground"}`} data-testid="text-stock-variance-count">{metric(varianceCount)}</p>
                <p className="mt-2 text-xs text-muted-foreground">Variansi stok pada interval.</p>
              </div>
            </section>

            <section className="mb-5 overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-label="Ringkasan penjualan per hari">
              <div className="border-b border-border px-4 py-4 sm:px-6">
                <p className="text-[10px] font-bold uppercase tracking-[.17em] text-[#967844]">Ringkasan harian</p>
                <h2 className="mt-1 font-serif text-xl font-bold">Penjualan otomatis per hari</h2>
                <p className="mt-1 text-xs text-muted-foreground">Penjualan dikelompokkan menurut tanggal kunjungan fisik terbaru pada setiap interval.</p>
              </div>
              {dailyTrend.length === 0 ? (
                <p className="px-5 py-8 text-center text-xs text-muted-foreground" data-testid="status-daily-trend-empty">Belum ada perbandingan kunjungan pada periode ini.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="bg-muted/50 text-[10px] uppercase tracking-[.12em] text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3 font-bold">Tanggal kunjungan</th>
                        <th className="px-4 py-3 text-right font-bold">Terjual otomatis</th>
                        <th className="px-5 py-3 text-right font-bold">Barang masuk dalam interval</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {dailyTrend.map(day => (
                        <tr key={day.date} className="transition-colors hover:bg-muted/30" data-testid={`row-daily-derived-sale-${day.date}`}>
                          <td className="px-5 py-3.5 font-semibold">{shortDate(day.date)}</td>
                          <td className="px-4 py-3.5 text-right font-mono font-bold text-primary" data-testid={`text-daily-derived-sale-${day.date}`}>
                            <span className="inline-flex items-center justify-end gap-1"><ArrowUpRight className="h-3.5 w-3.5" />{number(day.soldQuantity)} unit</span>
                          </td>
                          <td className="px-5 py-3.5 text-right font-mono text-muted-foreground" data-testid={`text-daily-restock-${day.date}`}>
                            <span className="inline-flex items-center justify-end gap-1"><ArrowDownRight className="h-3.5 w-3.5" />{number(day.restockQuantity)} unit</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-label="Penjualan otomatis per kunjungan">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
                <div><p className="text-[10px] font-bold uppercase tracking-[.17em] text-[#967844]">Sumber utama</p><h2 className="mt-1 font-serif text-xl font-bold">Penjualan per interval kunjungan</h2><p className="mt-1 text-xs text-muted-foreground">Setiap baris dikelompokkan pada tanggal kunjungan fisik terbaru.</p></div>
                <span className="rounded-full border border-primary/15 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary" data-testid="text-calculation-count">{number(calculations.length)} interval</span>
              </div>
              {calculations.length === 0 ? (
                <div className="px-5 py-12 text-center" data-testid="status-derived-sales-empty"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Clock3 className="h-5 w-5"/></div><p className="mt-3 text-sm font-semibold">Belum ada interval kunjungan untuk periode ini</p><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">Penjualan otomatis muncul setelah SKU memiliki setidaknya dua kunjungan stok. Catat hitungan fisik berikutnya di Operasional.</p><Link href="/operasional" className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground" data-testid="link-create-visit">Buka kunjungan</Link></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1050px] text-left text-sm">
                    <thead className="bg-muted/60 text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr>
                      <th className="px-5 py-3 font-bold">Tgl kunjungan</th><th className="px-4 py-3 font-bold">Toko / produk</th><th className="px-4 py-3 font-bold">Periode stok</th><th className="px-4 py-3 text-right font-bold">Stok awal</th><th className="px-4 py-3 text-right font-bold">Barang masuk</th><th className="px-4 py-3 text-right font-bold">Koreksi</th><th className="px-4 py-3 text-right font-bold">Hitung fisik</th><th className="px-5 py-3 text-right font-bold">Terjual</th>
                    </tr></thead>
                    <tbody className="divide-y divide-border">
                      {calculations.map((row, index) => (
                        <tr key={`${row.store}-${row.barcode}-${row.currentVisitAt}-${index}`} className="transition-colors hover:bg-muted/30" data-testid={`row-derived-sale-${row.store}-${row.barcode}-${index}`}>
                          <td className="whitespace-nowrap px-5 py-4 align-top"><span className="block font-semibold">{shortDate(row.currentVisitAt)}</span><span className="mt-1 block text-[11px] text-muted-foreground">{timestamp(row.currentVisitAt)}</span></td>
                          <td className="px-4 py-4 align-top"><span className="block max-w-52 truncate font-semibold">{row.product}</span><span className="mt-1 block text-[11px] text-muted-foreground">{row.store}</span><span className="mt-1 block font-mono text-[10px] text-muted-foreground">{row.barcode}</span></td>
                          <td className="px-4 py-4 align-top text-xs text-muted-foreground"><span className="block">Sebelumnya <b className="font-medium text-foreground">{timestamp(row.previousVisitAt)}</b></span><span className="mt-1 block">Sekarang <b className="font-medium text-foreground">{timestamp(row.currentVisitAt)}</b></span></td>
                          <td className="px-4 py-4 text-right font-mono">{number(row.previousStock)}</td>
                          <td className="px-4 py-4 text-right font-mono text-primary">+{number(row.restockQuantity)}</td>
                          <td className="px-4 py-4 text-right font-mono">{row.stockEntryAdjustment > 0 ? "+" : ""}{number(row.stockEntryAdjustment)}</td>
                          <td className="px-4 py-4 text-right font-mono">{number(row.currentStock)}</td>
                          <td className="px-5 py-4 text-right">
                            {row.soldQuantity < 0 ? (
                              <span className="inline-flex flex-col items-end" data-testid={`text-derived-sold-${row.barcode}-${index}`}>
                                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-900"><CircleAlert className="h-3.5 w-3.5"/> Variansi stok</span>
                                <span className="mt-1 text-[10px] text-amber-800">Selisih hitung {number(row.soldQuantity)} unit</span>
                              </span>
                            ) : (
                              <span className={`inline-flex min-w-16 items-center justify-end gap-1 rounded-lg px-2.5 py-1.5 font-mono font-bold ${row.hasStockVariance ? "bg-amber-100 text-amber-800" : "bg-primary/8 text-primary"}`} data-testid={`text-derived-sold-${row.barcode}-${index}`}><ArrowUpRight className="h-3.5 w-3.5"/>{number(row.soldQuantity)}</span>
                            )}
                            {row.hasStockVariance && row.soldQuantity >= 0 && <span className="mt-1 block text-[9px] font-bold uppercase tracking-wider text-amber-800">Variansi</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {calculations.length > 0 && <p className="border-t border-border px-5 py-3 text-[11px] leading-5 text-muted-foreground">Rumus audit: stok sebelumnya + barang masuk + koreksi input stok − hitung fisik terbaru = penjualan. Penerimaan terlambat masuk ke interval berdasarkan waktu diterima.</p>}
            </section>

            <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-label="Penjualan manual legacy">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
                <div><p className="text-[10px] font-bold uppercase tracking-[.17em] text-muted-foreground">Catatan legacy · terpisah</p><h2 className="mt-1 font-serif text-lg font-bold">Penjualan yang dicatat manual</h2><p className="mt-1 text-xs text-muted-foreground">Ditampilkan untuk riwayat saja dan tidak ditambahkan ke hasil otomatis di atas.</p></div>
                <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground" data-testid="text-daily-sales-count">{number(legacy.data?.length ?? 0)} transaksi</span>
              </div>
              {legacy.isError ? <div className="p-6 text-center text-sm text-destructive" role="alert" data-testid="status-daily-sales-error">Riwayat manual gagal dimuat. <button onClick={() => legacy.refetch()} className="font-bold underline" data-testid="button-retry-daily-sales">Coba lagi</button></div>
                : legacy.isLoading ? <div className="space-y-3 p-5" aria-label="Memuat transaksi manual"><div className="h-10 animate-pulse rounded-lg bg-muted"/><div className="h-10 animate-pulse rounded-lg bg-muted"/></div>
                : (legacy.data ?? []).length === 0 ? <p className="px-5 py-8 text-center text-xs text-muted-foreground" data-testid="status-daily-sales-empty">Tidak ada transaksi Penjualan manual dalam rentang yang dipilih.</p>
                : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-muted/50 text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-5 py-3">Waktu input</th><th className="px-4 py-3">Toko / produk</th><th className="px-4 py-3">Barcode</th><th className="px-5 py-3 text-right">Jumlah</th></tr></thead><tbody className="divide-y divide-border">{legacy.data?.map(entry => <tr key={entry.id} data-testid={`row-legacy-sale-${entry.id}`}><td className="whitespace-nowrap px-5 py-3.5 text-xs text-muted-foreground">{timestamp(entry.createdAt)}</td><td className="px-4 py-3.5"><span className="block font-semibold">{entry.product}</span><span className="text-xs text-muted-foreground">{entry.store}</span></td><td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">{entry.barcode}</td><td className="px-5 py-3.5 text-right font-mono font-bold">{number(entry.quantity)}</td></tr>)}</tbody></table></div>}
              {legacy.data && legacy.data.length === 5000 && <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">Menampilkan 5.000 catatan terbaru. Persempit rentang tanggal atau pilih toko.</p>}
            </section>
          </>
        )}
      </div>
    </main>
  );
}