// Logika status langganan yang dipakai bersama oleh App.tsx dan Subscription.tsx.
// Simpan sebagai: artifacts/stock-opname/src/lib/subscription.ts

export type SubRow = {
  plan_name: string | null;
  status: string | null;
  current_period_ends_at: string | null;
  trial_ends_at?: string | null;
};

export type EffectiveStatus =
  | "active"
  | "trial"
  | "expired"
  | "inactive"
  | "past_due"
  | "none";

const KNOWN_STATUSES: EffectiveStatus[] = [
  "active",
  "trial",
  "expired",
  "inactive",
  "past_due",
];

// Guard langganan di App.tsx hanya aktif jika flag ini "true".
// Nyalakan SETELAH: (1) semua akun lama punya baris di tabel subscriptions,
// (2) akun Owner Anda punya plan "Owner", dan (3) webhook pembayaran sudah teruji.
export const ENFORCE_SUBSCRIPTION =
  (import.meta.env.VITE_ENFORCE_SUBSCRIPTION as string | undefined) === "true";

// Hanya status ini yang boleh memakai aplikasi.
export function hasAccess(status: EffectiveStatus): boolean {
  return status === "active" || status === "trial";
}

// Menentukan status sebenarnya dari data + tanggal.
// Status "active"/"trial" di database tidak dipercaya mentah-mentah:
// kalau tanggal berakhirnya sudah lewat, dianggap "expired".
export function resolveStatus(
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