import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';
import App from './App';
import './index.css';

// KITA UBAH LANGSUNG ALAMATNYA DI SINI
// Gunakan domain Vercel utama Anda. 
// Jika backend dan frontend digabung, biasanya ini adalah domain Vercel Anda.
// Coba gunakan salah satu dari dua opsi di bawah ini (hapus tanda // di depannya):

setBaseUrl('https://www.kgebandung.online'); 
// ATAU JIKA MASIH ERROR, COBA YANG INI:
// setBaseUrl('https://kahfbrobandung-5h9w.vercel.app');

createRoot(document.getElementById('root')!).render(<App />);
