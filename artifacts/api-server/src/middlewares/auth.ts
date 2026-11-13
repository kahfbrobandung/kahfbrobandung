import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { Request, Response, NextFunction } from "express";

// ===========================================================================
// 1) ENV VALIDATION — FAIL FAST
// Jika env hilang, server langsung berhenti dengan pesan jelas,
// bukan error 401 misterius di production.
// ===========================================================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  const missing = [
    !supabaseUrl && "SUPABASE_URL",
    !supabaseServiceKey && "SUPABASE_SERVICE_ROLE_KEY",
  ]
    .filter(Boolean)
    .join(", ");
  console.error(`FATAL: Environment variables tidak lengkap: ${missing}`);
  throw new Error(`Missing Supabase environment variables: ${missing}`);
}

// ===========================================================================
// 2) SUPABASE ADMIN CLIENT — Singleton, DI-EXPORT
// Di-export supaya bisa dipakai ulang di routes lain (stock, store-sales, dll)
// tanpa bikin koneksi baru tiap file.
// ===========================================================================
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ===========================================================================
// 3) TYPE — AuthenticatedRequest
// Ganti `any` jadi `User` dari Supabase agar type-safe.
// ===========================================================================
export interface AuthenticatedRequest extends Request {
  user?: User;
}

// ===========================================================================
// 4) MIDDLEWARE — requireAuth
// ===========================================================================
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Preflight CORS — biarkan lewat
  if (req.method === "OPTIONS") {
    return next();
  }

  const authHeader = req.headers.authorization;

  // --- Validasi header ada & tipenya string ---
  if (!authHeader || typeof authHeader !== "string") {
    res.status(401).json({
      error: "Akses ditolak. Header Authorization tidak ditemukan.",
    });
    return;
  }

  // --- Validasi prefix "Bearer " ---
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: 'Akses ditolak. Format harus "Bearer <token>".',
    });
    return;
  }

  // --- Ambil token, trim spasi, cek tidak kosong ---
  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({
      error: "Akses ditolak. Token kosong.",
    });
    return;
  }

  // --- Verifikasi token ke Supabase ---
  // try/catch di sini menangkap network error / timeout,
  // bukan cuma "error" yang dikembalikan Supabase SDK.
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data?.user) {
      res.status(401).json({
        error: "Sesi tidak valid atau sudah berakhir.",
      });
      return;
    }

    req.user = data.user;
    next();
  } catch (err) {
    // Log detail untuk debugging, tapi jangan bocorkan ke client
    console.error("[requireAuth] Unexpected error verifying token:", err);
    res.status(500).json({
      error: "Terjadi kesalahan saat verifikasi sesi.",
    });
  }
}