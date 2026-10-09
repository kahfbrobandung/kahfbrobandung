import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';
import App from './App';
import './index.css';

// Panggil fungsi ini untuk mengatur alamat server Railway kamu
setBaseUrl(import.meta.env.VITE_API_URL);

createRoot(document.getElementById('root')!).render(<App />);
