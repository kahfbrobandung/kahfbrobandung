  import { useState } from 'react';
  import { useLocation } from 'wouter';
  import { supabase } from '@/lib/supabase';
  import { customFetch } from '@workspace/api-client-react';
  import { Store, Loader2 } from 'lucide-react';
  
  export default function Onboarding() {
    const [name, setName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [, setLocation] = useLocation();
  
    const handleCreateStore = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) return;
      setIsLoading(true);
      try {
        await customFetch('/api/stores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        setLocation('/');
        window.location.reload();
      } catch (error: any) {
        alert(error.message || 'Gagal membuat toko');
      } finally {
        setIsLoading(false);
      }
    };
  
    const handleLogout = async () => {
      await supabase.auth.signOut();
      setLocation('/login');
    };
  
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-xl border border-slate-200 dark:border-slate-800">
          <div className="flex justify-center mb-6 text-emerald-600">
            <Store size={48} />
          </div>
          <h1 className="text-2xl font-serif font-bold text-center mb-2 text-slate-800 dark:text-slate-100">Selamat Datang!</h1>
          <p className="text-center text-slate-500 text-sm mb-8">
            Mari mulai dengan membuat toko pertama Anda untuk menggunakan aplikasi Erlangga.
          </p>
  
          <form onSubmit={handleCreateStore} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Nama Toko / Cabang</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Borma Setiabudi"
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 dark:text-slate-100"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || !name.trim()}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : 'Buat Toko & Mulai'}
            </button>
          </form>
  
          <button onClick={handleLogout} className="w-full mt-4 text-xs text-red-500 font-bold hover:underline">
            Keluar Akun
          </button>
        </div>
      </div>
    );
  }