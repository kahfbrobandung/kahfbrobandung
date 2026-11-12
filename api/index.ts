import app from "../artifacts/api-server/src/app";

// Ekspor app Express untuk dijalankan sebagai Serverless Function oleh Vercel
export default app;

// Konfigurasi khusus Vercel untuk batas waktu eksekusi
export const config = {
  maxDuration: 60,
};