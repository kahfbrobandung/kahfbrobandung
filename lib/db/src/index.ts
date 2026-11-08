import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1, // Penting untuk Vercel Serverless agar koneksi tidak penuh
  idleTimeoutMillis: 30000
});

export const db = drizzle(pool, { schema });

// INI WAJIB ADA AGAR TABEL TERBACA DI BACKEND
export * from "./schema";