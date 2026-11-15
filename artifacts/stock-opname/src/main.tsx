import React from 'react';
import { createRoot } from 'react-dom/client';
// 1. Tambahkan setAuthTokenGetter di baris import ini
import { setBaseUrl, setAuthTokenGetter } from '@workspace/api-client-react';
import App from './App';
import './index.css';
import { ThemeProvider } from './components/theme-provider';

// Arahkan ke Backend Vercel
setBaseUrl('https://kahfbrobandung-7qyj.vercel.app');

// 2. TAMBAHKAN INI: Beri tahu API Client cara mengambil token
setAuthTokenGetter(() => {
  // ⚠️ PENTING: Pastikan "token" adalah nama yang sama dengan yang Anda simpan saat Login!
  // Jika di file Login Anda menulis localStorage.setItem("token", ...), biarkan "token".
  return localStorage.getItem("token");
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);

// Hilangkan layar loading di index.html setelah aplikasi siap
const loader = document.getElementById('initial-loader');
if (loader) {
  loader.style.opacity = '0'; // Efek fade out
  setTimeout(() => {
    loader.remove(); // Hapus elemen dari layar
  }, 300);
}