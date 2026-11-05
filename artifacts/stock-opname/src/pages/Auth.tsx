import { useState } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Box, Lock, Mail, User as UserIcon, Loader2 } from "lucide-react";

export default function Auth() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // ⚠️ GANTI URL DI BAWAH INI DENGAN URL BACKEND VERCEL KAMU
    // Cek dashboard Vercel, cari project yang isinya api-server, copy link domainnya.
    // Contoh: https://kahfbrobandung-bay.vercel.app
    const API_BASE_URL = "https://kahfbrobandung-bay.vercel.app"; 

    const endpoint = isLogin 
      ? `${API_BASE_URL}/api/auth/login` 
      : `${API_BASE_URL}/api/auth/register`;
      
    const payload = isLogin ? { email, password } : { email, password, name };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // BACA SEBAGAI TEKS DULU UNTUK MENGHINDARI CRASH
      const textData = await response.text();
      let data;
      
      try {
        data = JSON.parse(textData);
      } catch (e) {
        console.error("Server Error Response:", textData);
        throw new Error(`Server Error (${response.status}): Gagal terhubung ke API.`);
      }

      if (!response.ok) {
        throw new Error(data.error || "Terjadi kesalahan pada server");
      }

      // Simpan token ke localStorage
      localStorage.setItem("erlangga_token", data.token);
      localStorage.setItem("erlangga_user", JSON.stringify(data.user));

      toast({
        title: isLogin ? "Login Berhasil" : "Registrasi Berhasil",
        description: `Selamat datang, ${data.user.name}!`,
      });

      // Arahkan ke halaman utama
      setLocation("/");
      
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-card border border-border shadow-lg rounded-2xl p-6 sm:p-8">
        
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
            <Box className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-foreground">Erlangga</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isLogin ? "Masuk ke akun toko Anda" : "Daftar akun toko baru"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-foreground">Nama Anda</label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Budi"
                  className="w-full pl-9 pr-3 py-2.5 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 text-sm"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-foreground">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@toko.com"
                className="w-full pl-9 pr-3 py-2.5 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-foreground">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 6 karakter"
                className="w-full pl-9 pr-3 py-2.5 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-primary text-primary-foreground font-semibold rounded-xl shadow-md hover:bg-primary/90 transition-all flex items-center justify-center gap-2 disabled:opacity-70 mt-6"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Memproses...
              </>
            ) : (
              isLogin ? "Masuk" : "Daftar Sekarang"
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setEmail("");
              setPassword("");
              setName("");
            }}
            className="text-sm text-primary font-medium hover:underline"
          >
            {isLogin 
              ? "Belum punya akun? Daftar di sini" 
              : "Sudah punya akun? Masuk di sini"}
          </button>
        </div>
      </div>
    </div>
  );
}
