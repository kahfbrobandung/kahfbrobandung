import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/supabase";
import { Link } from "wouter";
import {
  ArrowLeft, CheckCircle2, ShieldAlert, Clock, ExternalLink,
  Crown, CalendarDays, Loader2, MessageCircle, RefreshCw, Copy, Check,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Tipe & konstanta
// ---------------------------------------------------------------------------
type SubRow = {
  plan_name: string | null;
  status: string | null;
  current_period_ends_at: string | null;
  trial_ends_at?: string | null;
};

type EffectiveStatus =
  | "active"
  | "trial"
  | "expired"
  | "inactive"
  | "past_due"
  | "none";

const STATUS_LABEL: Record<EffectiveStatus, string> = {
  active: "Aktif",
  trial: "Trial",
  inactive: "Tidak Aktif",
  expired: "Kedaluwarsa",
  past_due: "Tertunda",
  none: "Belum Berlangganan",
};

const KNOWN_STATUSES: EffectiveStatus[] = [
  "active",
  "trial",
  "expired",
  "inactive",
  "past_due",
];

// Bisa dioverride lewat environment variable Vercel; nilai lama jadi cadangan.
const WA_NUMBER =
  (import.meta.env.VITE_WA_NUMBER as string | undefined) || "6285173033115";
const LYNK_ID_URL =
  (import.meta.env.VITE_LYNK_URL as string | undefined) ||
  "https://lynk.id/erlanggasama/z5zor11421lw";

// Ubah ke "true" HANYA setelah webhook Lynk.id di backend benar-benar aktif.
// false = alur lama (kirim bukti via WhatsApp, aktivasi manual).
const AUTO_ACTIVATION =
  (import.meta.env.VITE_AUTO_ACTIVATION as string | undefined) === "true";

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Menentukan status sebenarnya dari data + tanggal.
// Status "active"/"trial" di database tidak dipercaya mentah-mentah:
// kalau tanggal berakhirnya sudah lewat, tampilkan sebagai "expired".
// ---------------------------------------------------------------------------
function resolveStatus(
  sub: SubRow | null,
  now: number,
): { status: EffectiveStatus; endDate: Date | null } {
  if (!sub) return { status: "none", endDate: null };

  const parse = (iso: string | null | undefined) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  // Paket Owner tidak pernah dianggap kedaluwarsa.
  if ((sub.plan_name ?? "").toLowerCase() === "owner") {
    return { status: "active", endDate: parse(sub.current_period_ends_at) };
  }

  const raw = (sub.status ?? "inactive") as EffectiveStatus;
  let status: EffectiveStatus = KNOWN_STATUSES.includes(raw) ? raw : "inactive";

  const endDate =
    status === "trial"
      ? parse(sub.trial_ends_at) ?? parse(sub.current_period_ends_at)
      : parse(sub.current_period_ends_at);

  if ((status === "active" || status === "trial") && endDate && endDate.getTime() < now) {
    status = "expired";
  }

  return { status, endDate };
}

export default function Subscription() {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [subData, setSubData] = useState<SubRow | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Status menunggu konfirmasi pembayaran (hanya dipakai jika AUTO_ACTIVATION)
  const [waiting, setWaiting] = useState(false);
  const [waitTimedOut, setWaitTimedOut] = useState(false);
  const [justActivated, setJustActivated] = useState(false);
  const baselineEnd = useRef<number | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted.current) return;

      if (!session) {
        setAuthed(false);
        return;
      }
      setAuthed(true);
      setEmail(session.user.email ?? null);

      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!mounted.current) return;

      if (error) {
        console.error("Error fetching subscription:", error);
        setLoadError(true);
        return;
      }
      setLoadError(false);
      setHasLoaded(true);
      setSubData((data as SubRow | null) ?? null);
    } catch (err) {
      console.error("Gagal memuat data:", err);
      if (mounted.current) setLoadError(true);
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Muat pertama kali
  useEffect(() => {
    void load(true);
  }, [load]);

  // Muat ulang saat pengguna kembali ke tab ini (mis. setelah bayar di Lynk.id)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const { status, endDate } = resolveStatus(subData, Date.now());
  const isActive = status === "active";
  const endMs = endDate ? endDate.getTime() : null;

  // Pembayaran terdeteksi: status aktif, dan (kalau sebelumnya sudah aktif)
  // tanggal berakhirnya bertambah.
  const paymentDetected =
    waiting &&
    isActive &&
    (baselineEnd.current === null ||
      (endMs !== null && endMs > baselineEnd.current));

  useEffect(() => {
    if (paymentDetected) {
      setWaiting(false);
      setJustActivated(true);
    }
  }, [paymentDetected]);

  // Polling selama menunggu konfirmasi (maksimal 5 menit)
  useEffect(() => {
    if (!waiting) return;
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - startedAt > POLL_MAX_MS) {
        window.clearInterval(id);
        setWaiting(false);
        setWaitTimedOut(true);
        return;
      }
      void load(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [waiting, load]);

  const handlePayClick = () => {
    if (!AUTO_ACTIVATION) return;
    baselineEnd.current = isActive ? endMs : null;
    setJustActivated(false);
    setWaitTimedOut(false);
    setWaiting(true);
  };

  const handleCopyEmail = async () => {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard tidak tersedia; abaikan */
    }
  };

  // -------------------------------------------------------------------------
  // Tampilan awal
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center font-medium text-slate-500">
        <Loader2 className="animate-spin mb-4 text-blue-500" size={32} />
        Memuat data langganan...
      </div>
    );
  }

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

  // -------------------------------------------------------------------------
  // Turunan tampilan
  // -------------------------------------------------------------------------
  const planName = subData?.plan_name ?? (status === "none" ? "Belum Ada" : "Basic");
  const isOwner = (subData?.plan_name ?? "").toLowerCase() === "owner";
  const isNone = status === "none";
  const isTrial = status === "trial";
  const isExpiredOrInactive =
    status === "expired" || status === "inactive" || status === "past_due";

  const endDateLabel = endDate
    ? endDate.toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "-";

  const daysLeft = endDate ? Math.ceil((endDate.getTime() - Date.now()) / DAY_MS) : null;
  const expiringSoon =
    !isOwner &&
    (status === "active" || status === "trial") &&
    daysLeft !== null &&
    daysLeft >= 0 &&
    daysLeft <= 7;

  const statusBadgeClass =
    status === "active"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : status === "trial"
      ? "bg-blue-100 text-blue-700 border-blue-200"
      : status === "none"
      ? "bg-amber-100 text-amber-700 border-amber-200"
      : "bg-red-100 text-red-700 border-red-200";

  const waMessage = encodeURIComponent(
    `Halo, saya sudah bayar langganan.\n\nEmail akun: ${email ?? "-"}\nMohon aktifkan akses saya. Terima kasih.`,
  );
  const WA_URL = `https://wa.me/${WA_NUMBER}?text=${waMessage}`;

  // Mode manual: tombol WhatsApp selalu tampil. Mode otomatis: hanya sebagai cadangan.
  const showWaButton = AUTO_ACTIVATION ? !isActive && !waiting : true;

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-950 flex flex-col items-center pb-12">
      <header className="w-full max-w-md bg-gradient-to-br from-blue-600 to-indigo-800 text-white pt-10 pb-8 px-6 shadow-xl rounded-b-[2rem] mb-6 sticky top-0 z-20 relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white opacity-10 rounded-full blur-2xl"></div>
        <div className="relative z-10 flex justify-between items-start mb-2">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-100 hover:text-white mb-3 transition-colors"
            >
              <ArrowLeft size={16} /> Kembali ke Home
            </Link>
            <h1 className="text-3xl font-serif font-bold tracking-tight">Langganan</h1>
            <h2 className="text-sm text-blue-100 font-medium mt-1">
              Kelola status langganan Anda
            </h2>
          </div>
        </div>
      </header>

      <main className="w-full max-w-md px-4 flex flex-col gap-6">
        {/* Gagal memuat & belum pernah berhasil: jangan tampilkan status palsu */}
        {loadError && !hasLoaded ? (
          <div className="bg-white dark:bg-slate-900 border border-red-100 dark:border-slate-800 shadow-xl rounded-3xl p-8 text-center">
            <ShieldAlert size={48} className="text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
              Status langganan gagal dimuat
            </h2>
            <p className="text-sm text-slate-500 mb-6">
              Periksa koneksi internet Anda, lalu coba lagi.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold disabled:opacity-60"
            >
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
              Coba Lagi
            </button>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-slate-800 shadow-xl shadow-blue-100/50 dark:shadow-none rounded-3xl p-8 text-center relative overflow-hidden">
            <div className="flex justify-center mb-5 relative">
              <div
                className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full blur-xl ${
                  isOwner ? "bg-amber-300" : "bg-blue-200"
                }`}
              ></div>
              {isOwner ? (
                <div className="p-3 bg-gradient-to-br from-amber-100 to-yellow-200 rounded-full shadow-inner relative z-10 border border-amber-300">
                  <Crown size={48} className="text-amber-500 fill-amber-500" />
                </div>
              ) : status === "active" ? (
                <CheckCircle2 size={64} className="text-emerald-500 relative z-10" />
              ) : status === "trial" ? (
                <Clock size={64} className="text-blue-500 relative z-10" />
              ) : status === "none" ? (
                <ShieldAlert size={64} className="text-amber-500 relative z-10" />
              ) : (
                <ShieldAlert size={64} className="text-red-500 relative z-10" />
              )}
            </div>

            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">
              {isNone ? "Belum Ada Langganan" : `${planName} Plan`}
            </h2>

            <div className="flex justify-center mb-6">
              <span
                className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-wide uppercase border ${statusBadgeClass}`}
              >
                {STATUS_LABEL[status]}
              </span>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950 rounded-2xl p-5 mb-6 border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center gap-1">
              <CalendarDays size={20} className="text-blue-500 mb-1" />
              <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">
                Masa Aktif Hingga
              </p>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100">
                {endDateLabel}
              </p>
              {daysLeft !== null && daysLeft >= 0 && !isOwner && (
                <p className="text-xs text-slate-500">{daysLeft} hari lagi</p>
              )}
            </div>

            {/* Gagal menyegarkan, tapi data lama masih ada */}
            {loadError && hasLoaded && (
              <div className="mb-6 p-3 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900 rounded-2xl text-xs text-red-700 dark:text-red-300">
                Gagal memperbarui status. Data yang tampil mungkin belum terbaru.
              </div>
            )}

            {/* Pesan khusus sesuai status */}
            {justActivated && (
              <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 rounded-2xl text-sm text-emerald-700 dark:text-emerald-300">
                Pembayaran terdeteksi. Langganan Anda sudah <strong>aktif</strong>.
              </div>
            )}

            {isNone && (
              <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900 rounded-2xl text-sm text-amber-700 dark:text-amber-300">
                Anda belum memiliki langganan. Berlangganan untuk memakai semua fitur.
              </div>
            )}

            {isTrial && (
              <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 rounded-2xl text-sm text-blue-700 dark:text-blue-300">
                Anda sedang dalam masa <strong>Trial</strong>. Segera berlangganan agar akses tetap aktif.
              </div>
            )}

            {isExpiredOrInactive && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900 rounded-2xl text-sm text-red-700 dark:text-red-300">
                Langganan Anda sudah <strong>berakhir</strong>. Silakan perpanjang untuk melanjutkan penggunaan.
              </div>
            )}

            {expiringSoon && status === "active" && (
              <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900 rounded-2xl text-sm text-amber-700 dark:text-amber-300">
                Langganan Anda akan berakhir dalam <strong>{daysLeft} hari</strong>. Perpanjang agar akses tidak terputus.
              </div>
            )}

            {/* Email akun: dipakai untuk mencocokkan pembayaran */}
            {!isOwner && email && (
              <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-2xl text-left">
                <p className="text-[12px] text-slate-500 leading-relaxed mb-2">
                  {AUTO_ACTIVATION
                    ? "Gunakan email akun ini saat checkout di Lynk.id agar pembayaran terhubung otomatis:"
                    : "Cantumkan email akun ini saat mengirim bukti pembayaran:"}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 break-all">
                    {email}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyEmail()}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 transition-colors"
                    aria-label="Salin email akun"
                  >
                    {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    {copied ? "Disalin" : "Salin"}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <a
                href={LYNK_ID_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handlePayClick}
                className="flex items-center justify-center gap-2 w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-600/30 active:scale-95"
              >
                {status === "active" ? "Perpanjang Langganan" : "Bayar Langganan"}
                <ExternalLink size={18} />
              </a>

              {/* Menunggu konfirmasi (mode otomatis) */}
              {AUTO_ACTIVATION && waiting && (
                <div className="flex items-center justify-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 rounded-2xl text-sm text-blue-700 dark:text-blue-300">
                  <Loader2 className="animate-spin" size={16} />
                  Menunggu konfirmasi pembayaran. Halaman ini diperbarui otomatis.
                </div>
              )}

              {AUTO_ACTIVATION && waitTimedOut && !isActive && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900 rounded-2xl text-sm text-amber-700 dark:text-amber-300">
                  Pembayaran belum terdeteksi. Jika sudah membayar, tunggu beberapa menit lalu muat ulang status, atau hubungi kami lewat WhatsApp.
                </div>
              )}

              {showWaButton && (
                <a
                  href={WA_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3.5 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 hover:border-green-500 text-slate-700 dark:text-slate-200 font-semibold rounded-2xl transition-all active:scale-95"
                >
                  <MessageCircle size={18} className="text-green-600" />
                  {AUTO_ACTIVATION ? "Pembayaran Belum Terdeteksi? Hubungi Kami" : "Kirim Bukti Pembayaran"}
                </a>
              )}

              <button
                type="button"
                onClick={() => void load()}
                disabled={refreshing}
                className="flex items-center justify-center gap-2 w-full py-2.5 text-sm font-semibold text-slate-500 hover:text-blue-600 transition-colors disabled:opacity-60"
              >
                <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                Muat Ulang Status
              </button>

              <div className="pt-1 space-y-1.5">
                {AUTO_ACTIVATION ? (
                  <p className="text-[12px] text-slate-500 text-center leading-relaxed">
                    Setelah pembayaran di <strong>Lynk.id</strong> berhasil, langganan aktif otomatis.
                  </p>
                ) : (
                  <>
                    <p className="text-[12px] text-slate-500 text-center leading-relaxed">
                      Setelah bayar di <strong>Lynk.id</strong>, kirim bukti pembayaran via WhatsApp.
                    </p>
                    <p className="text-[11px] text-slate-400 text-center">
                      Akses akan diaktifkan maksimal <strong>1×24 jam</strong> setelah bukti diterima.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}