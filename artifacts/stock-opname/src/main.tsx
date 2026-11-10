import React from 'react';
import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';
import App from './App';
import './index.css';
import { ThemeProvider } from './components/theme-provider';

// 1. PERBAIKAN: Arahkan ke Backend Vercel (Bukan Railway lagi)
setBaseUrl('https://kahfbrobandung-7qyj.vercel.app');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);

// 2. PERBAIKAN: Hilangkan layar loading di index.html setelah aplikasi siap
const loader = document.getElementById('initial-loader');
if (loader) {
  loader.style.opacity = '0'; // Efek fade out
  setTimeout(() => {
    loader.remove(); // Hapus elemen dari layar
  }, 300);
}