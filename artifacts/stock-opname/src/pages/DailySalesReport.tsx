import { useState, useMemo } from "react";
import { Link } from "wouter";
import { ArrowLeft, TrendingUp, PackageMinus, AlertCircle, CalendarDays, Trash2, Info } from "lucide-react";
import { useStoreName } from "@/hooks/useStoreName";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/supabase";
import { useToast } from "@/hooks/use-toast";

type VisitData = { id: string; visited_at: string; };
type LineData = { visit_id: string; barcode: string; product: string; total_quantity: number; };
type RestockData = { id: string; received_at: string; barcode: string; product: string; quantity: number; };

export default function DailySalesReport() {
  const [storeName] = useStoreName();
  const activeStore = storeName.trim();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    const lastYear = new Date();
    lastYear.setFullYear(today.getFullYear() - 1);
    return {
      from: lastYear.toLocaleDateString('en-CA'),
      to: today.toLocaleDateString('en-CA'),
    };
  });

  // 1. AMBIL DATA
  const { data: rawData, isLoading, isError } = useQuery({
    queryKey: ['salesReport', activeStore, dateRange.from, dateRange.to],
    queryFn: async () => {
      if (!activeStore) return { visits: [], lines: [], restocks: [] };

      const { data: storeData } = await supabase.from('stores').select('id').ilike('name', activeStore).limit(1).maybeSingle();
      if (!storeData) return { visits: [], lines: [], restocks: [] };

      const { data: visits } = await supabase
        .from('stock_visits')
        .select('id, visited_at')
        .eq('store_id', storeData.id)
        .gte('visited_at', dateRange.from + 'T00:00:00')
        .lte('visited_at', dateRange.to + 'T23:59:59')
        .order('visited_at', { ascending: true });

      if (!visits || visits.length === 0) return { visits: [], lines: [], restocks: [] };

      const visitIds = visits.map(v => v.id);
      const { data: lines } = await supabase
        .from('stocktake_lines')
        .select('visit_id, barcode, product, total_quantity')
        .in('visit_id', visitIds);

      const { data: restocks } = await supabase
        .from('stock_restocks')
        .select('id, received_at, barcode, product, quantity')
        .eq('store_id', storeData.id)
        .gte('received_at', dateRange.from + 'T00:00:00')
        .lte('received_at', dateRange.to + 'T23:59:59')
        .order('received_at', { ascending: true });

      return { 
        visits: (visits || []) as VisitData[], 
        lines: (lines || []) as LineData[], 
        restocks: (restocks || []) as RestockData[] 
      };
    },
    enabled: !!activeStore,
  });

  // 2. HITUNG LAPORAN
  const report = useMemo(() => {
    if (!rawData) return { totalSold: 0, totalRestocked: 0, items: [], skipped: 0 };

    const productMap = new Map<string, { product: string, visits: { date: string, qty: number, id: string }[], restocks: { date: string, qty: number }[] }>();

    rawData.visits.forEach(visit => {
      const visitLines = rawData.lines.filter(l => l.visit_id === visit.id);
      visitLines.forEach(line => {
        if (!productMap.has(line.barcode)) {
          productMap.set(line.barcode, { product: line.product, visits: [], restocks: [] });
        }
        productMap.get(line.barcode)!.visits.push({ date: visit.visited_at, qty: line.total_quantity, id: visit.id });
      });
    });

    rawData.restocks.forEach(r => {
      if (!productMap.has(r.barcode)) {
         productMap.set(r.barcode, { product: r.product, visits: [], restocks: [] });
      }
      productMap.get(r.barcode)!.restocks.push({ date: r.received_at, qty: r.quantity });
    });

    let totalSold = 0;
    let totalRestocked = 0;
    let skippedCount = 0;
    const reportItems: any[] = [];

    productMap.forEach((data, barcode) => {
      if (data.visits.length < 2) return; 

      const sortedVisits = data.visits.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      for (let i = 0; i < sortedVisits.length - 1; i++) {
        const start = sortedVisits[i];
        const end = sortedVisits[i + 1];

        let restockBetween = 0;
        data.restocks.forEach(r => {
          const rTime = new Date(r.date).getTime();
          if (rTime >= new Date(start.date).getTime() && rTime <= new Date(end.date).getTime()) {
            restockBetween += r.qty;
          }
        });

        const sold = (start.qty + restockBetween) - end.qty;

        if (sold > 0) {
          totalSold += sold;
          totalRestocked += restockBetween;
          reportItems.push({
            date: end.date, product: data.product, barcode,
            startQty: start.qty, restock: restockBetween, endQty: end.qty, sold, endVisitId: end.id
          });
        } else if (sold < 0) {
          skippedCount++; 
        }
      }
    });

    reportItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { totalSold, totalRestocked, items: reportItems, skipped: skippedCount };
  }, [rawData]);

  const handleDelete = async (visitId: string) => {
    if (!window.confirm("Hapus data kunjungan SO ini? Laporan dan Stok akan dihitung ulang.")) return;
    try {
      await supabase.from('stocktake_lines').delete().eq('visit_id', visitId);
      const { error } = await supabase.from('stock_visits').delete().eq('id', visitId);
      if (error) throw error;
      
      // PERBAIKAN: Invalidasi SEMUA cache agar Laporan & Home langsung terupdate
      queryClient.invalidateQueries(); 
      
      toast({ title: "Berhasil", description: "Data kunjungan dihapus." });
    } catch (error: any) {
      toast({ title: "Gagal", description: error.message, variant: "destructive" });
    }
  };

  const formatDateIndo = (dateString: string) => {
    const d = new Date(dateString); 
    return d.toLocaleDateString("id-ID", { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  };

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-950 flex flex-col items-center pb-12">
      <header className="w-full max-w-md bg-gradient-to-br from-sky-600 to-blue-700 text-white pt-10 pb-6 px-6 shadow-lg rounded-b-[2rem] mb-6 sticky top-0 z-20">
        <div className="flex justify-between items-start mb-2">
          <div>
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-100 hover:text-white mb-2 transition-colors">
              <ArrowLeft size={16} /> Kembali ke Home
            </Link>
            <h1 className="text-2xl font-serif font-bold tracking-tight">Laporan Penjualan</h1>
            <h2 className="text-sm text-sky-100 font-medium">Toko: {activeStore || "-"}</h2>
          </div>
        </div>
      </header>

      <main className="w-full max-w-md px-4 flex-1 flex flex-col gap-6">
        <div className="bg-white border border-sky-100 shadow-sm rounded-2xl p-4 flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-semibold text-sky-700 block mb-1">Dari</label>
            <input type="date" value={dateRange.from} max={dateRange.to} onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })} className="w-full px-3 py-2 bg-sky-50 border border-sky-200 rounded-xl text-sm outline-none" />
          </div>
          <div className="flex-1">
            <label className="text-xs font-semibold text-sky-700 block mb-1">Sampai</label>
            <input type="date" value={dateRange.to} min={dateRange.from} onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })} className="w-full px-3 py-2 bg-sky-50 border border-sky-200 rounded-xl text-sm outline-none" />
          </div>
        </div>

        {isError && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl p-4 flex items-center gap-3">
            <AlertCircle size={20} />
            <p className="text-sm font-medium">Gagal memuat data. Periksa koneksi internet Anda.</p>
          </div>
        )}

        {isLoading ? (
           <div className="h-32 animate-pulse rounded-2xl bg-sky-100" />
        ) : (
          <>
            <div className="bg-white border border-sky-100 shadow-sm rounded-2xl p-5">
              <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2 text-slate-800">
                <TrendingUp size={18} className="text-sky-600" /> Ringkasan Penjualan
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-sky-50 rounded-xl p-3 border border-sky-100">
                  <p className="text-xs text-sky-600 font-semibold">Total Terjual</p>
                  <p className="text-2xl font-bold text-sky-700">{report.totalSold} <span className="text-sm font-normal">pcs</span></p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                  <p className="text-xs text-emerald-600 font-semibold">Total Barang Masuk</p>
                  <p className="text-2xl font-bold text-emerald-700">{report.totalRestocked} <span className="text-sm font-normal">pcs</span></p>
                </div>
              </div>
            </div>

            {report.skipped > 0 && (
              <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-2xl p-4 flex items-start gap-3 text-sm">
                <Info size={20} className="shrink-0 mt-0.5" />
                <p>Terdapat {report.skipped} data SO yang <strong>stoknya bertambah</strong> (tidak dihitung sebagai penjualan). Pastikan Anda menginput "Barang Masuk" jika ada kiriman stok baru.</p>
              </div>
            )}

            <div className="bg-white border border-sky-100 shadow-sm rounded-2xl p-5">
              <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2 text-slate-800">
                <PackageMinus size={18} className="text-sky-600" /> Detail Penjualan
              </h3>
              
              {report.items.length === 0 ? (
                <div className="text-center py-8 text-sky-600 border border-dashed border-sky-200 rounded-xl bg-sky-50/50">
                  Belum ada penjualan terdeteksi. <br/>
                  <span className="text-xs text-slate-500 mt-2 block">Pastikan ada minimal 2 SO untuk produk yang sama dan stok akhir lebih sedikit dari stok awal.</span>
                </div>
              ) : (
                <ul className="space-y-3">
                  {report.items.map((item, idx) => (
                    <li key={idx} className="border border-sky-100 rounded-xl p-4 shadow-sm bg-white relative">
                      <div className="flex justify-between items-start mb-2">
                        <div className="pr-8">
                          <p className="text-sm font-bold text-slate-800">{item.product}</p>
                          <p className="text-[10px] text-sky-600 font-mono">{item.barcode}</p>
                          <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1"><CalendarDays size={10}/> {formatDateIndo(item.date)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase font-bold text-sky-600">Terjual</p>
                          <p className="text-xl font-bold text-sky-600">{item.sold} <span className="text-xs font-normal">pcs</span></p>
                        </div>
                      </div>
                      
                      <button onClick={() => handleDelete(item.endVisitId)} className="absolute top-3 right-3 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" title="Hapus data SO ini"><Trash2 size={14} /></button>

                      <div className="grid grid-cols-3 gap-1 bg-sky-50 rounded-lg p-2 text-center text-xs mt-2">
                        <div><p className="text-[10px] text-slate-500">SO Awal</p><p className="font-bold">{item.startQty}</p></div>
                        <div className="border-x border-sky-200"><p className="text-[10px] text-slate-500">Masuk</p><p className="font-bold text-emerald-600">+{item.restock}</p></div>
                        <div><p className="text-[10px] text-slate-500">SO Akhir</p><p className="font-bold">{item.endQty}</p></div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}