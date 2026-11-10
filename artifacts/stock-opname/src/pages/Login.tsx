import { useState } from "react";
import { supabase } from "../supabase";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";

// Helper untuk menerjemahkan error Supabase ke Bahasa Indonesia
const translateAuthError = (msg: string) => {
  const lower = msg.toLowerCase();
  if (lower.includes("invalid login credentials")) return "Email atau password salah.";
  if (lower.includes("user already registered")) return "Email sudah terdaftar. Silakan login.";
  if (lower.includes("password should be at least")) return "Password minimal harus 6 karakter.";
  if (lower.includes("email not confirmed")) return "Email belum diverifikasi. Silakan cek kotak masuk/spam Anda.";
  if (lower.includes("rate limit")) return "Terlalu banyak percobaan. Silakan tunggu beberapa saat.";
  if (lower.includes("invalid email")) return "Format email tidak valid.";
  return msg;
};

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();

    // Validasi frontend (cegah request sia-sia ke server)
    if (password.length < 6) {
      return toast({ title: "Perhatian", description: "Password minimal 6 karakter.", variant: "destructive" });
    }

    setLoading(true);
    try {
      if (isRegister) {
        const { data, error } = await supabase.auth.signUp({ email: cleanEmail, password });
        if (error) throw error;
        
        // Jika Supabase tidak mewajibkan verifikasi email (auto login)
        if (data.session) {
          toast({ title: "Registrasi Berhasil", description: "Selamat datang di Erlangga!" });
          setLocation("/");
        } else {
          toast({ title: "Registrasi Berhasil", description: "Silakan cek email Anda untuk verifikasi, lalu login." });
          setIsRegister(false);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        toast({ title: "Login Berhasil", description: "Selamat datang kembali!" });
        setLocation("/");
      }
    } catch (error: any) {
      toast({ 
        title: "Gagal", 
        description: translateAuthError(error.message), 
        variant: "destructive" 
      });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) return toast({ title: "Perhatian", description: "Masukkan email Anda dulu.", variant: "destructive" });
    
    setLoading(true);
    try {
      // PERBAIKAN: Hapus '/#/' agar tidak 404 saat link diklik
      const redirectUrl = window.location.origin + '/reset-password';
      
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: redirectUrl,
      });
      if (error) throw error;
      
      // Standar keamanan: Jangan bocorkan apakah email terdaftar atau tidak
      toast({ 
        title: "Email Terkirim", 
        description: "Jika email Anda terdaftar, silakan cek kotak masuk/spam untuk link reset password." 
      });
      setIsForgotPassword(false);
    } catch (error: any) {
      toast({ title: "Gagal", description: translateAuthError(error.message), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-sky-50/50 dark:bg-slate-950 p-4">
      <Card className="w-full max-w-md shadow-xl border-sky-100 dark:border-slate-800">
        <CardHeader className="text-center pb-6">
          <CardTitle className="text-3xl font-serif font-bold text-sky-700 dark:text-sky-500">Erlangga</CardTitle>
          <CardDescription className="text-slate-500">Sistem Pencatatan Stok</CardDescription>
        </CardHeader>
        <CardContent>
          
          {isForgotPassword ? (
            // TAMPILAN LUPA PASSWORD
            <form onSubmit={handleForgotPassword} className="space-y-4 animate-in fade-in zoom-in-95">
              <div className="text-center mb-4">
                <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100">Lupa Password?</h3>
                <p className="text-xs text-slate-500 mt-1">Masukkan email Anda, kami akan mengirimkan link untuk membuat password baru.</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Email Terdaftar</label>
                <Input 
                  type="email" 
                  placeholder="nama@email.com" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  required 
                  className="bg-sky-50/50 dark:bg-slate-950 border-sky-200 dark:border-slate-800 focus-visible:ring-sky-500"
                />
              </div>
              <Button type="submit" className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-6" disabled={loading}>
                {loading ? "Mengirim..." : "Kirim Link Reset"}
              </Button>
              <div className="text-center mt-4">
                <button type="button" onClick={() => setIsForgotPassword(false)} className="text-slate-500 hover:text-slate-700 text-sm font-semibold flex items-center justify-center gap-1 mx-auto transition-colors">
                  <ArrowLeft size={14} /> Kembali ke Login
                </button>
              </div>
            </form>
          ) : (
            // TAMPILAN LOGIN / DAFTAR
            <>
              <form onSubmit={handleAuth} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Email</label>
                  <Input 
                    type="email" 
                    placeholder="nama@email.com" 
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                    required 
                    className="bg-sky-50/50 dark:bg-slate-950 border-sky-200 dark:border-slate-800 focus-visible:ring-sky-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Password</label>
                  <div className="relative">
                    <Input 
                      type={showPassword ? "text" : "password"} 
                      placeholder="••••••••" 
                      value={password} 
                      onChange={(e) => setPassword(e.target.value)} 
                      required 
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
                {!isRegister && (
                  <div className="flex justify-end">
                    <button 
                      type="button" 
                      onClick={() => setIsForgotPassword(true)} 
                      className="text-xs font-semibold text-sky-600 hover:text-sky-800 hover:underline"
                    >
                      Lupa Password?
                    </button>
                  </div>
                )}
                <Button type="submit" className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-6" disabled={loading}>
                  {loading ? "Memproses..." : isRegister ? "Daftar Akun" : "Masuk"}
                </Button>
              </form>
              <div className="mt-6 text-center text-sm">
                <button 
                  type="button" 
                  onClick={() => {
                    setIsRegister(!isRegister);
                    setPassword(""); // Reset password saat ganti mode
                  }} 
                  className="text-sky-600 hover:text-sky-800 font-semibold hover:underline transition-colors"
                >
                  {isRegister ? "Sudah punya akun? Masuk" : "Belum punya akun? Daftar"}
                </button>
              </div>
            </>
          )}

        </CardContent>
      </Card>
    </div>
  );
}