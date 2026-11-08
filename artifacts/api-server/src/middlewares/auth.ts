import { createClient } from '@supabase/supabase-js';
import type { Request, Response, NextFunction } from 'express';

// Pastikan kamu sudah menambahkan SUPABASE_URL dan SUPABASE_ANON_KEY di Environment Variables Vercel Backend
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Akses ditolak. Silakan login.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  
  // Cek token ke Supabase, apakah valid dan siapa usernya
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'Sesi tidak valid atau sudah berakhir.' });
    return;
  }

  // Simpan data user ke req agar bisa dipakai di file store-sales.ts
  (req as any).user = user;
  next();
}