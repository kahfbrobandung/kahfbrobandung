import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

// --- 1. Sesuaikan Connection String untuk Supabase Transaction Pooler ---
let connectionString = process.env.DATABASE_URL;

// Paksa gunakan port 6543 (Transaction Mode) untuk Vercel Serverless
if (connectionString.includes(':5432')) {
  connectionString = connectionString.replace(':5432', ':6543');
  console.warn('⚠️ Port database diubah ke 6543 (Transaction Mode) untuk kompatibilitas serverless.');
}

// Tambahkan parameter wajib untuk Supabase + PgBouncer
const url = new URL(connectionString);
if (!url.searchParams.has('pgbouncer')) {
  url.searchParams.set('pgbouncer', 'true');
}
if (!url.searchParams.has('connection_limit')) {
  url.searchParams.set('connection_limit', '1');
}
connectionString = url.toString();

// --- 2. Konfigurasi Pool yang Optimal untuk Serverless ---
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Diperlukan untuk koneksi aman ke Supabase
  max: 1,                             // Satu koneksi per instance fungsi (rekomendasi Supabase)
  idleTimeoutMillis: 10000,           // Tutup koneksi idle lebih agresif (10 detik)
  connectionTimeoutMillis: 10000,     // Batas waktu percobaan koneksi (10 detik)
  allowExitOnIdle: true,              // Izinkan proses Node.js berhenti saat idle
});

// Penanganan error tak terduga pada level pool agar tidak mematikan proses
pool.on('error', (err) => {
  console.error('🔥 Unexpected error on idle database client', err);
});

// --- 3. Global Instance (Mencegah Kebocoran Koneksi saat Development) ---
const globalForDb = globalThis as unknown as { pool: pg.Pool | undefined };
export const dbPool = globalForDb.pool ?? pool;
if (process.env.NODE_ENV !== "production") globalForDb.pool = dbPool;

export const db = drizzle(dbPool, { schema });

// Re-export schema agar tabel terbaca di backend
export * from "./schema";