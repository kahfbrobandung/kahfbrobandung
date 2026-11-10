import { useState, useEffect } from "react";
import { supabase } from "@/supabase";
import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, ShieldAlert, Clock, ExternalLink } from "lucide-react";

export default function Subscription() {
  const [loading, setLoading] = useState(true);
  const [subData, setSubData] = useState<any>(null);

  useEffect(() => {
    async function fetchSub() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Ambil data langganan dari database
      const { data } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", session.user.id)
        .single();

      setSubData(data);
      setLoading(false);
    }
    fetchSub();
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center font-medium">Memuat data langganan...</div>;
  }

  // Default jika data belum ada
  const plan = subData || { plan_name: "Basic", status: "trial", current_period_ends_at: null };
  
  // Format tanggal
  const endDate = plan.current_period_ends_at 
    ? new Date(plan.current_period_ends_at).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
    : "-";

  // LINK PRODUK LYNK.ID KAMU
  const LYNK_ID_URL = "https://lynk.id/erlanggasama/z5zor11421lw";

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-950 flex flex-col items-center pb-12">
      <header className="w-full max-w-md bg-gradient-to-br from-sky-600 to-blue-700 text-white pt-10 pb-6 px-6 shadow-lg rounded-b-[2rem] mb-6 sticky top-0 z-20">
        <div className="flex justify-between items-start mb-2">
          <div>
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-100 hover:text-white mb-2 transition-colors">
              <ArrowLeft size={16} /> Kembali ke Home
            </Link>
            <h1 className="text-2xl font-serif font-bold tracking-tight">Langganan Saya</h1>
            <h2 className="text-sm text-sky-100 font-medium">Status akun Erlangga Anda</h2>
          </div>
        </div>
      </header>

      <main className="w-full max-w-md px-4 flex flex-col gap-6">
        <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 shadow-sm rounded-2xl p-6 text-center">
          
          <div className="flex justify-center mb-4">
            {plan.status === "active" ? (
              <CheckCircle2 size={64} className="text-emerald-500" />
            ) : plan.status === "trial" ? (
              <Clock size={64} className="text-amber-500" />
            ) : (
              <ShieldAlert size={64} className="text-red-500" />
            )}
          </div>
          
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">
            {plan.plan_name} Plan
          </h2>
          
          <p className="text-sm text-slate-500 mb-6">
            Status: <span className={`font-bold ${
              plan.status === "active" ? "text-emerald-600" : 
              plan.status === "trial" ? "text-amber-600" : "text-red-600"
            }`}>
              {plan.status.toUpperCase()}
            </span>
          </p>

          <div className="bg-sky-50 dark:bg-sky-900/20 rounded-xl p-4 mb-6">
            <p className="text-xs text-sky-600 dark:text-sky-400 mb-1">Masa Aktif Hingga</p>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100">
              {endDate}
            </p>
          </div>

          {/* TOMBOL PEMBAYARAN VIA LYNK.ID */}
          <div className="space-y-3">
            <a 
              href={LYNK_ID_URL}
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3.5 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl transition-colors shadow-md"
            >
              {plan.status === "active" ? "Perpanjang Langganan" : "Bayar Langganan Sekarang"}
              <ExternalLink size={16} />
            </a>
            
            <p className="text-[11px] text-slate-400">
              Pembayaran aman & otomatis melalui <strong>Lynk.id</strong>. 
              Akses akan terbuka otomatis setelah pembayaran berhasil.
            </p>
          </div>

        </div>
      </main>
    </div>
  );
}