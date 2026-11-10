import { useState, useEffect } from "react";
import { supabase } from "@/supabase";
import { Link } from "wouter";
import {
  ArrowLeft, CheckCircle2, ShieldAlert, Clock, ExternalLink,
  Crown, CalendarDays, Loader2,
} from "lucide-react";

type SubRow = {
  plan_name: string | null;
  status: string | null;
  current_period_ends_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  trial: "Trial",
  inactive: "Tidak Aktif",
  expired: "Kedaluwarsa",
  past_due: "Tertunda",
};

export default function Subscription() {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [subData, setSubData] = useState<SubRow | null>(null);

  useEffect(() => {
    async function fetchSub() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setAuthed(false);
          return;
        }
        setAuthed(true);

        const { data, error } = await supabase
          .from("subscriptions")
          .select("plan_name, status, current_period_ends_at")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (error) {
          console.error("Error fetching subscription:", error);
        } else {
          setSubData((data as SubRow | null) ?? null);
        }
      } catch (err) {
        console.error("Gagal memuat data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchSub();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center font-medium text-slate-500">
        <Loader2 className="animate-spin mb-4 text-blue-500" size={32} />
        Memuat data langganan...
      </div>
    );
  }

  // BUG FIX #1: user belum login
  if (authed === false) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 text-center bg-slate-50">
        <ShieldAlert size={48} className="text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-slate-800 mb-2">Silakan Login Dulu</h2>
        <p className="text-sm text-slate-500 mb-6">
          Anda harus masuk untuk melihat status langganan.
        </p>
        <Link href="/login" className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold">
          Ke Halaman Login
        </Link>
      </div>
    );
  }

  // BUG FIX #2: fallback per-field (bukan ganti seluruh object)
  const planName = subData?.plan_name ?? "Basic";
  const status = subData?.status ?? "trial";
  const endDateISO = subData?.current_period_ends_at ?? null;

  const isOwner = planName.toLowerCase() === "owner";
  const statusText = STATUS_LABEL[status] ?? status;

  const endDate = endDateISO
    ? new Date(endDateISO).toLocaleDateString("id-ID", {
        day: "2-digit", month: "long", year: "numeric",
      })
    : "-";

  const LYNK_ID_URL = "https://lynk.id/erlanggasama/z5zor11421lw";

  const statusBadgeClass =
    status === "active"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : status === "trial"
      ? "bg-blue-100 text-blue-700 border-blue-200"
      : "bg-red-100 text-red-700 border-red-200";

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-950 flex flex-col items-center pb-12">
      <header className="w-full max-w-md bg-gradient-to-br from-blue-600 to-indigo-800 text-white pt-10 pb-8 px-6 shadow-xl rounded-b-[2rem] mb-6 sticky top-0 z-20 relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white opacity-10 rounded-full blur-2xl"></div>
        <div className="relative z-10 flex justify-between items-start mb-2">
          <div>
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-100 hover:text-white mb-3 transition-colors">
              <ArrowLeft size={16} /> Kembali ke Home
            </Link>
            <h1 className="text-3xl font-serif font-bold tracking-tight">Langganan</h1>
            <h2 className="text-sm text-blue-100 font-medium mt-1">Kelola status akun Erlangga Anda</h2>
          </div>
        </div>
      </header>

      <main className="w-full max-w-md px-4 flex flex-col gap-6">
        <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-slate-800 shadow-xl shadow-blue-100/50 dark:shadow-none rounded-3xl p-8 text-center relative overflow-hidden">
          <div className="flex justify-center mb-5 relative">
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full blur-xl ${isOwner ? 'bg-amber-300' : 'bg-blue-200'}`}></div>
            {isOwner ? (
              <div className="p-3 bg-gradient-to-br from-amber-100 to-yellow-200 rounded-full shadow-inner relative z-10 border border-amber-300">
                <Crown size={48} className="text-amber-500 fill-amber-500" />
              </div>
            ) : status === "active" ? (
              <CheckCircle2 size={64} className="text-emerald-500 relative z-10" />
            ) : status === "trial" ? (
              <Clock size={64} className="text-blue-500 relative z-10" />
            ) : (
              <ShieldAlert size={64} className="text-red-500 relative z-10" />
            )}
          </div>

          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">
            {planName} Plan
          </h2>

          <div className="flex justify-center mb-6">
            <span className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-wide uppercase border ${statusBadgeClass}`}>
              {statusText}
            </span>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 rounded-2xl p-5 mb-8 border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center gap-1">
            <CalendarDays size={20} className="text-blue-500 mb-1" />
            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Masa Aktif Hingga</p>
            <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{endDate}</p>
          </div>

          <div className="space-y-3">
            <a
              href={LYNK_ID_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-600/30 active:scale-95"
            >
              {status === "active" ? "Perpanjang Langganan" : "Bayar Langganan"}
              <ExternalLink size={18} />
            </a>

            <div className="flex items-center justify-center gap-2 pt-2">
              <ShieldAlert size={12} className="text-slate-400" />
              <p className="text-[11px] text-slate-400 text-center">
                Pembayaran aman via <strong className="text-slate-500">Lynk.id</strong>. Akses otomatis aktif.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}