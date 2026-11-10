import { useState } from 'react';
import { useLocation } from 'wouter';
import { supabase } from '@/supabase';
import { customFetch, getListStoresQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Store, Loader2, AlertCircle } from 'lucide-react';

export default function Onboarding() {
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();

    // 1. VALIDASI FRONTEND (Cegah request sampah ke server)
    if (cleanName.length < 2) {
      setErrorMsg('Nama toko minimal 2 karakter.');
      return;
    }
    if (cleanName.length > 50) {
      setErrorMsg('Nama toko maksimal 50 karakter.');
      return;
    }

    setErrorMsg('');
    setIsLoading(true);
    
    try {
      await customFetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName }),
      });

      // 2. ANTI REFRESH: Hapus window.location.reload()
      // Cukup perbarui cache data toko, lalu pindah halaman
      queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
      
      toast({ 
        title: "Toko Berhasil Dibuat!", 
        description: `Selamat datang di ${cleanName}.` 
      });
      
      setLocation('/');
      
    } catch (error: any) {
      // 3. TERJEMAHKAN ERROR AGAR RAMAH PENGGUNA
      const msg = error?.message || '';
      if (msg.toLowerCase().includes('sudah terdaftar')) {
        setErrorMsg('Nama toko ini sudah dipakai. Silakan gunakan nama lain.');
      } else {
        setErrorMsg(msg || 'Gagal membuat toko. Periksa koneksi internet Anda.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setLocation('/login');
  };

  return (
    <div className="min-h-screen bg-sky-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-xl border border-sky-100 dark:border-slate-800 animate-in fade-in zoom-in-95">
        
        <div className="flex justify-center mb-6 text-sky-600">
          <div className="p-4 bg-sky-100 dark:bg-sky-900/30 rounded-full">
            <Store size={48} />
          </div>
        </div>
        
        <h1 className="text-2xl font-serif font-bold text-center mb-2 text-slate-800 dark:text-slate-100">Selamat Datang!</h1>
        <p className="text-center text-slate-500 text-sm mb-8 leading-relaxed">
          Mari mulai dengan membuat toko pertama Anda untuk menggunakan aplikasi Erlangga.
        </p>

        {/* TAMPILAN PESAN ERROR (MENGGANTIKAN alert) */}
        {errorMsg && (
          <div className="mb-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm p-3 rounded-xl flex items-start gap-2 border border-red-100 dark:border-red-800 animate-in slide-in-from-top-2">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <p>{errorMsg}</p>
          </div>
        )}

        <form onSubmit={handleCreateStore} className="space-y-5">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Nama Toko / Cabang</label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errorMsg) setErrorMsg(''); // Hapus error saat user mulai mengetik lagi
              }}
              placeholder="Contoh: Erlangga Cabang Dago"
              maxLength={50}
              className="w-full px-4 py-3 bg-sky-50 dark:bg-slate-950 border border-sky-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none text-slate-800 dark:text-slate-100 transition-all font-medium"
              required
              autoFocus
            />
          </div>
          
          <button
            type="submit"
            disabled={isLoading || !name.trim()}
            className="w-full py-3.5 bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98]"
          >
            {isLoading ? (
              <><Loader2 className="animate-spin" size={20} /> Menyiapkan Toko...</>
            ) : (
              'Buat Toko & Mulai'
            )}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-sky-100 dark:border-slate-800 text-center">
          <button 
            type="button"
            onClick={handleLogout} 
            className="text-xs text-slate-400 hover:text-red-500 font-semibold transition-colors"
          >
            Batal & Keluar Akun
          </button>
        </div>
      </div>
    </div>
  );
}