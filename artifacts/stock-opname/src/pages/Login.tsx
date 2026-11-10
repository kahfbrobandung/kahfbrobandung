import { useState } from "react";
import { supabase } from "../supabase";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isRegister) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast({ title: "Registrasi Berhasil", description: "Silakan login." });
        setIsRegister(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast({ title: "Login Berhasil", description: "Selamat datang!" });
        setLocation("/");
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return toast({ title: "Perhatian", description: "Masukkan email Anda dulu.", variant: "destructive" });
    
    setLoading(true);
    try {
      // Mengirim email reset password, arahkan link ke halaman reset-password aplikasi kita
      const redirectUrl = window.location.origin + '/#/reset-password';
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });
      if (error) throw error;
      
      toast({ title: "Email Terkirim", description: "Silakan cek kotak masuk/spam email Anda untuk link reset password." });
      setIsForgotPassword(false);
    } catch (error: any) {
      toast({ title: "Gagal", description: error.message, variant: "destructive" });
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
                  <Input 
                    type="password" 
                    placeholder="••••••••" 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    required 
                    className="bg-sky-50/50 dark:bg-slate-950 border-sky-200 dark:border-slate-800 focus-visible:ring-sky-500"
                  />
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
                  onClick={() => setIsRegister(!isRegister)} 
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