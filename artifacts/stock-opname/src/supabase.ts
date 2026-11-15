import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// FIX: Ganti warn menjadi throw error (Fail-Fast)
// Agar aplikasi tidak crash dengan layar putih tanpa alasan yang jelas.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "FATAL: VITE_SUPABASE_URL atau VITE_SUPABASE_ANON_KEY belum diatur di Environment Variables Vercel!"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);