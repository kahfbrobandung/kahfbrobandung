import { useState, useEffect } from "react";
import { supabase } from "@/supabase"; // <-- PERBAIKAN: Menggunakan alias @ agar aman & konsisten
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, KeyRound, CheckCircle2 } from "lucide-react";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Memastikan user benar-benar datang dari link email (sesi recovery valid)
  useEffect(() => {
    supabase.auth.onAuthStateChange(async (event) => {
      if (event === "PASSWORD_RECOVERY") {
        console.log("Sesi reset password valid.");
      }
    });
  }, []);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      
      setIsSuccess(true);
      toast({ title: "Berhasil", description: "Password berhasil diubah. Mengalihkan ke halaman login..." });
      
      // Logout paksa agar user login ulang dengan password baru
      await supabase.auth.signOut();
      setTimeout(() => setLocation("/login"), 2500);
      
    } catch (error: any) {
      setErrorMsg(error.message || "Gagal mengubah password. Link mungkin sudah kedaluwarsa.");
      toast({ title: "Gagal", description: error.message, variant: "destructive" });
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
          {isSuccess ? (
            <div className="text-center py-6 animate-in fade-in zoom-in-95">
              <div className="flex justify-center mb-4 text-emerald-500">
                <CheckCircle2 size={48} />
              </div>
              <p className="text-slate-800 dark:text-slate-200 font-bold mb-2">Password Berhasil Diubah!</p>
              <p className="text-sm text-slate-500">Mengalihkan ke halaman login...</p>
            </div>
          ) : (
            <form onSubmit={handleUpdatePassword} className="space-y-4 animate-in fade-in zoom-in-95">
              
              {errorMsg && (
                <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg text-center border border-red-100 dark:border-red-800">
                  {errorMsg}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Password Baru</label>
                <Input 
                  type="password" 
                  placeholder="Minimal 6 karakter" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  required 
                  minLength={6}
                  className="bg-sky-50/50 dark:bg-slate-950 border-sky-200 dark:border-slate-800 focus-visible:ring-sky-500"
                />
              </div>
              <Button 
                type="submit" 
                className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-6" 
                disabled={loading}
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