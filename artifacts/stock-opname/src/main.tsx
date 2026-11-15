import React from 'react';
import { createRoot } from 'react-dom/client';
import { setBaseUrl, setAuthTokenGetter } from '@workspace/api-client-react';
import App from './App';
import './index.css';
import { ThemeProvider } from './components/theme-provider';
import { supabase } from './supabase'; // Pastikan path ini benar (sesuai kode Login Anda)

// 1. Arahkan ke Backend Vercel
setBaseUrl('https://kahfbrobandung-7qyj.vercel.app');

// 2. Ambil token langsung dari Supabase
setAuthTokenGetter(async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);

// Hilangkan layar loading
const loader = document.getElementById('initial-loader');
if (loader) {
  loader.style.opacity = '0';
  setTimeout(() => {
    loader.remove();
  }, 300);
}