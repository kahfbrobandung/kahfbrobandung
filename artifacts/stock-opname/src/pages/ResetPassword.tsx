import { useState, useEffect } from "react";
import { supabase } from "@/supabase";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, KeyRound, CheckCircle2, Eye, EyeOff, ShieldAlert } from "lucide-react";

const translateAuthError = (msg: string) => {
  const lower = msg.toLowerCase();
  if (lower.includes("password should be at least")) return "Password minimal harus 6 karakter.";
  if (lower.includes("auth session missing")) return "Sesi tidak valid. Silakan minta link reset password baru.";
  if (lower.includes("expired")) return "Link reset password sudah kedaluwarsa. Silakan minta link baru.";
  return msg;
};

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSessionValid, setIsSessionValid] = useState(true); // Default true, akan diubah jika tidak valid
  const [errorMsg, setErrorMsg] = useState("");
  
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    // 1. Cek apakah ada sesi aktif (dari link email)
    supabase.auth.getSession().then(({ data: { session } }) => {
      // Jika tidak ada sesi login/recovery, berarti user masuk ke halaman ini secara ilegal/atau link expired
      if (!session) {
        // Beri jeda sedikit, karena Supabase butuh waktu memproses token di URL
        setTimeout(() => {
          supabase.auth.getSession().then(({ data: { session: retrySession } }) => {
             if (!retrySession) setIsSessionValid(false);
          });
        }, 1000);
      }
    });

    // 2. Dengarkan event PASSWORD_RECOVERY & pastikan di-unsubscribe (anti memory leak)
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsSessionValid(true);
      }
    });

    return () => {
      authListener.subscription.unsubscribe(); // Bersihkan listener saat keluar halaman
    };
  }, []);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validasi Konfirmasi Password
    if (password !== confirmPassword) {
      return toast({ title: "Perhatian", description: "Password baru dan konfirmasi tidak cocok.", variant: "destructive" });
    }
    if (password.length < 6) {
      return toast({ title: "Perhatian", description: "Password minimal 6 karakter.", variant: "destructive" });
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      
      setIsSuccess(true);
      toast({ title: "Berhasil", description: "Password berhasil diubah." });
      
      // Logout paksa agar user login ulang dengan password baru
      await supabase.auth.signOut();
      
      // Redirect ke login setelah 3 detik
      setTimeout(() => setLocation("/login"), 3000);
      
    } catch (error: any) {
      const translatedMsg = translateAuthError(error.message);
      setErrorMsg(translatedMsg);
      toast({ title: "Gagal", description: translatedMsg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-sky-50/50 dark:bg-slate-950 p-4">
      <Card className="w-full max-w-md shadow-xl border-sky-100 dark:border-slate-800">
        <CardHeader className="text-center pb-6">
          <div className="flex justify-center mb-4 text-sky-600">
            <KeyRound size={40} />
          </div>
          <CardTitle className="text-2xl font-serif font-bold text-sky-700 dark:text-sky-500">Buat Password Baru</CardTitle>
          <CardDescription className="text-slate-500">
            Masukkan password baru untuk akun Erlangga Anda.
          </CardDescription>
        </CardHeader>
        <CardContent>
          
          {!isSessionValid ? (
            // TAMPILAN JIKA LINK EXPIRED / AKSES ILEGAL
            <div className="text-center py-6 animate-in fade-in zoom-in-95">
              <div className="flex justify-center mb-4 text-red-500">
                <ShieldAlert size={48} />
              </div>
              <p className="text-slate-800 dark:text-slate-200 font-bold mb-2">Link Tidak Valid</p>
              <p className="text-sm text-slate-500 mb-6">Link reset password sudah kedaluwarsa atau tidak valid. Silakan minta link baru dari halaman login.</p>
              <Button onClick={() => setLocation("/login")} className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-6">
                Kembali ke Login
              </Button>
            </div>
          ) : isSuccess ? (
            // TAMPILAN SUKSES
            <div className="text-center py-6 animate-in fade-in zoom-in-95">
              <div className="flex justify-center mb-4 text-emerald-500">
                <CheckCircle2 size={48} />
              </div>
              <p className="text-slate-800 dark:text-slate-200 font-bold mb-2">Password Berhasil Diubah!</p>
              <p className="text-sm text-slate-500">Mengalihkan ke halaman login...</p>
            </div>
          ) : (
            // TAMPILAN FORM INPUT
            <form onSubmit={handleUpdatePassword} className="space-y-4 animate-in fade-in zoom-in-95">
              
              {errorMsg && (
                <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg text-center border border-red-100 dark:border-red-800">
                  {errorMsg}
                </div>
              )}

              {/* Input Password Baru */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Password Baru</label>
                <div className="relative">
                  <Input 
                    type={showPassword ? "text" : "password"} 
                    placeholder="Minimal 6 karakter" 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    required 
                    minLength={6}
                    className="bg-sky-50/50 dark:bg-slate-950 border-sky-200 dark:border-slate-800 focus-visible:ring-sky-500 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Input Konfirmasi Password */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Ulangi Password Baru</label>
                <div className="relative">
                  <Input 
                    type={showConfirmPassword ? "text" : "password"} 
                    placeholder="Ketik ulang password" 
                    value={confirmPassword} 
                    onChange={(e) => setConfirmPassword(e.target.value)} 
                    required 
                    minLength={6}
                    className="bg-sky-50/50 dark:bg-slate-950 border-sky-200 dark:border-slate-800 focus-visible:ring-sky-500 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <Button 
                type="submit" 
                className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-6 mt-2" 
                disabled={loading || !password || !confirmPassword}
              >
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Menyimpan...</> : "Simpan Password Baru"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}