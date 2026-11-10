import { Link } from "wouter";
import { Compass, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center bg-sky-50/50 dark:bg-slate-950 p-6">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-xl border border-sky-100 dark:border-slate-800 text-center animate-in fade-in zoom-in-95">
        
        {/* Ikon Ilustrasi */}
        <div className="flex justify-center mb-6">
          <div className="p-5 bg-sky-100 dark:bg-sky-900/30 rounded-full text-sky-600 dark:text-sky-400">
            <Compass size={56} className="animate-pulse" />
          </div>
        </div>

        {/* Teks Utama */}
        <h1 className="text-4xl font-serif font-bold text-slate-800 dark:text-slate-100 mb-2">404</h1>
        <h2 className="text-lg font-bold text-slate-700 dark:text-slate-300 mb-3">Halaman Tidak Ditemukan</h2>
        
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
          Maaf, halaman yang Anda cari tidak ada, sudah dipindahkan, atau URL yang Anda ketik salah.
        </p>

        {/* Tombol Navigasi */}
        <div className="space-y-3">
          <Link href="/">
            <Button className="w-full h-12 bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white font-bold rounded-xl shadow-md transition-all active:scale-[0.98]">
              <Home size={18} className="mr-2" /> Kembali ke Beranda
            </Button>
          </Link>
          
          <button 
            onClick={() => window.history.back()} 
            className="w-full h-12 flex items-center justify-center gap-2 text-sm font-semibold text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 transition-colors"
          >
            <ArrowLeft size={16} /> Kembali ke Halaman Sebelumnya
          </button>
        </div>

      </div>
      
      {/* Footer Kecil */}
      <p className="mt-8 text-xs text-slate-400">
        &copy; {new Date().getFullYear()} Erlangga App. All rights reserved.
      </p>
    </div>
  );
}