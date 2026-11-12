import { createClient } from '@supabase/supabase-js';
import type { Request, Response, NextFunction } from 'express';

const supabaseUrl = process.env.SUPABASE_URL;
// WAJIB pakai SERVICE_ROLE_KEY di backend, bukan ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// FAIL-FAST: Jangan biarkan API jalan kalau env tidak lengkap
if (!supabaseUrl || !supabaseServiceKey) {
  console.error("FATAL: SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY tidak diset!");
  throw new Error("Missing Supabase environment variables");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Tambahkan tipe data agar tidak pakai 'any' lagi
export interface AuthenticatedRequest extends Request {
  user?: any;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.method === 'OPTIONS') {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Akses ditolak. Silakan login.' });
    return;
  }

  const token = authHeader.split(' ')[1];

  // Verifikasi token user ke Supabase
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'Sesi tidak valid atau sudah berakhir.' });
    return;
  }

  req.user = user;
  next();
}