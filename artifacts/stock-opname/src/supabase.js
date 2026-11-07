import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Peringatan: URL atau Key Supabase belum dimasukkan di Vercel!");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
