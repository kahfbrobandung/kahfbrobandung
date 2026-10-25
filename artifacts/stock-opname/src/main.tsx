import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';
import App from './App';
import './index.css';
import { ThemeProvider } from './components/theme-provider';

setBaseUrl('https://workspaceapi-server-production-07b9.up.railway.app');

createRoot(document.getElementById('root')!).render(
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <App />
  </ThemeProvider>
);
