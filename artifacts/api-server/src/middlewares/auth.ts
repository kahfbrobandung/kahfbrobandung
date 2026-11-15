import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger"; // FIX 1: Import logger

// ===========================================================================
// 1) ENV VALIDATION — FAIL FAST
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
    
  // FIX 2: Gunakan logger sebelum server crash
  logger.error(`FATAL: Environment variables tidak lengkap: ${missing}`);
  throw new Error(`Missing Supabase environment variables: ${missing}`);
}

// ===========================================================================
// 2) SUPABASE ADMIN CLIENT — Singleton
// ===========================================================================
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ===========================================================================
// 3) TYPE — AuthenticatedRequest
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

  if (!authHeader || typeof authHeader !== "string") {
    res.status(401).json({
      error: "Akses ditolak. Header Authorization tidak ditemukan.",
    });
    return;
  }

  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: 'Akses ditolak. Format harus "Bearer <token>".',
    });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({
      error: "Akses ditolak. Token kosong.",
    });
    return;
  }

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
    // FIX 3: Gunakan logger, bukan console.error
    logger.error({ err }, "[requireAuth] Unexpected error verifying token");
    res.status(500).json({
      error: "Terjadi kesalahan saat verifikasi sesi.",
    });
  }
}