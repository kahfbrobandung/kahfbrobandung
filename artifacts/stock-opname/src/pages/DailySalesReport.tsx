import { useState, useMemo } from "react";
import { Link } from "wouter";
import { ArrowLeft, TrendingUp, PackageMinus, AlertCircle, CalendarDays } from "lucide-react";
import { useStoreName } from "@/hooks/useStoreName";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/supabase";

type ProductHistory = {
  barcode: string;
  product: string;
  visits: { date: string; qty: number }[];
  restocks: { date: string; qty: number }[];
};

export default function DailySalesReport() {
  const [storeName] = useStoreName();
  const activeStore = storeName.trim();
  
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setDate(today.getDate() - 30);
    return {
      from: lastMonth.toLocaleDateString('en-CA'),
      to: today.toLocaleDateString('en-CA'),
    };
  });

  // 1. AMBIL DATA KUNJUNGAN SO & BARANG MASUK DARI SUPABASE
  const { data: rawData, isLoading, isError } = useQuery({
    queryKey: ['salesReport', activeStore, dateRange.from, dateRange.to],
    queryFn: async () => {
      if (!activeStore) return { visits: [], restocks: [] };

      // Ambil ID Toko berdasarkan nama
      const { data: storeData } = await supabase
        .from('stores').select('id').eq('name', activeStore).maybeSingle();
      if (!storeData) return { visits: [], restocks: [] };

      // Ambil Kunjungan SO beserta detail barangnya (stocktake_lines)
      const { data: visits } = await supabase
        .from('stock_visits')
        .select(`visited_at, stocktake_lines ( barcode, product, total_quantity )`)
        .eq('store_id', storeData.id)
        .gte('visited_at', dateRange.from)
        .lte('visited_at', dateRange.to + 'T23:59:59')
        .order('visited_at', { ascending: true });

      // Ambil Barang Masuk
      const { data: restocks } = await supabase
        .from('stock_restocks')
        .select(`received_at, barcode, product, quantity`)
        .eq('store_id', storeData.id)
        .gte('received_at', dateRange.from)
        .lte('received_at', dateRange.to + 'T23:59:59')
        .order('received_at', { ascending: true });

      return { visits: visits || [], restocks: restocks || [] };
    },
    enabled: !!activeStore,
  });

  // 2. HITUNG PENJUALAN (Stok Awal - Stok Akhir + Barang Masuk)
  const report = useMemo(() => {
    if (!rawData) return { totalSold: 0, totalRestocked: 0, items: [] };

    const historyMap = new Map<string, ProductHistory>();

    // Masukkan data kunjungan (SO)
    rawData.visits.forEach((visit: any) => {
      const date = visit.visited_at;
      visit.stocktake_lines?.forEach((line: any) => {
        if (!historyMap.has(line.barcode)) {
          historyMap.set(line.barcode, { barcode: line.barcode, product: line.product, visits: [], restocks: [] });
        }
        historyMap.get(line.barcode)!.visits.push({ date, qty: line.total_quantity });
      });
    });

    // Masukkan data restock
    rawData.restocks.forEach((restock: any) => {
      if (!historyMap.has(restock.barcode)) {
        historyMap.set(restock.barcode, { barcode: restock.barcode, product: restock.product, visits: [], restocks: [] });
      }
      historyMap.get(restock.barcode)!.restocks.push({ date: restock.received_at, qty: restock.quantity });
    });

    let totalSold = 0;
    let totalRestocked = 0;
    const reportItems: any[] = [];

    // Proses hitung per produk
    historyMap.forEach((product) => {
      // Butuh minimal 2 kunjungan untuk melihat selisih penjualan
      if (product.visits.length < 2) return; 

      let productSoldTotal = 0;
      let productRestockedTotal = 0;
      
      // Urutkan kunjungan berdasarkan tanggal (terlama ke terbaru)
      const sortedVisits = product.visits.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Hitung selisih antar kunjungan
      for (let i = 0; i < sortedVisits.length - 1; i++) {
        const startVisit = sortedVisits[i];
        const endVisit = sortedVisits[i + 1];

        // Cari barang masuk di antara 2 kunjungan ini
        let restockBetween = 0;
        product.restocks.forEach(r => {
          const rTime = new Date(r.date).getTime();
          if (rTime >= new Date(startVisit.date).getTime() && rTime <= new Date(endVisit.date).getTime()) {
            restockBetween += r.qty;
          }
        });

        // Rumus Penjualan: (Stok Awal + Barang Masuk) - Stok Akhir
        const sold = (startVisit.qty + restockBetween) - endVisit.qty;
        
        if (sold > 0) {
           productSoldTotal += sold;
           totalSold += sold;
           totalRestocked += restockBetween;

           reportItems.push({
             date: endVisit.date,
             product: product.product,
             barcode: product.barcode,
             startQty: startVisit.qty,
             restock: restockBetween,
             endQty: endVisit.qty,
             sold: sold
           });
        }
      }
    });

    // Urutkan laporan dari tanggal terbaru
    reportItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return { totalSold, totalRestocked, items: reportItems };
  }, [rawData]);

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
            <input type="date" value={dateRange.from} max={dateRange.to} onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })} className="w-full px-3 py-2 bg-sky-50 dark:bg-slate-950 border border-sky-200 rounded-xl text-sm outline-none" />
          </div>
          <div className="flex-1">
            <label className="text-xs font-semibold text-sky-700 dark:text-sky-500 block mb-1">Sampai</label>
            <input type="date" value={dateRange.to} min={dateRange.from} onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })} className="w-full px-3 py-2 bg-sky-50 dark:bg-slate-950 border border-sky-200 rounded-xl text-sm outline-none" />
          </div>
        </div>

        {isError && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl p-4 flex items-center gap-3">
            <AlertCircle size={20} />
            <p className="text-sm font-medium">Gagal memuat data. Periksa koneksi internet Anda.</p>
          </div>
        )}

        {isLoading ? (
           <div className="h-32 animate-pulse rounded-2xl bg-sky-100 dark:bg-slate-800" />
        ) : (
          <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 shadow-sm rounded-2xl p-5">
            <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2 text-slate-800 dark:text-slate-100">
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
        )}

        <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 shadow-sm rounded-2xl p-5">
          <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <PackageMinus size={18} className="text-sky-600" /> Detail Penjualan
          </h3>
          
          {isLoading ? (
            <div className="h-20 animate-pulse bg-sky-100 rounded-xl" />
          ) : report.items.length === 0 ? (
            <div className="text-center py-8 text-sky-600 border border-dashed border-sky-200 rounded-xl bg-sky-50/50">
              Belum ada penjualan terdeteksi. <br/>
              <span className="text-xs text-slate-500 mt-2 block">(Lakukan minimal 2 Kunjungan SO untuk melihat selisih penjualan).</span>
            </div>
          ) : (
            <ul className="space-y-3">
              {report.items.map((item, idx) => (
                <li key={idx} className="border border-sky-100 rounded-xl p-4 shadow-sm bg-white">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{item.product}</p>
                      <p className="text-[10px] text-sky-600 font-mono">{item.barcode}</p>
                      <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1"><CalendarDays size={10}/> {formatDateIndo(item.date)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase font-bold text-sky-600">Terjual</p>
                      <p className="text-xl font-bold text-sky-600">{item.sold} <span className="text-xs font-normal">pcs</span></p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1 bg-sky-50 rounded-lg p-2 text-center text-xs mt-2">
                    <div>
                      <p className="text-[10px] text-slate-500">SO Awal</p>
                      <p className="font-bold">{item.startQty}</p>
                    </div>
                    <div className="border-x border-sky-200">
                      <p className="text-[10px] text-slate-500">Masuk</p>
                      <p className="font-bold text-emerald-600">+{item.restock}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">SO Akhir</p>
                      <p className="font-bold">{item.endQty}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}