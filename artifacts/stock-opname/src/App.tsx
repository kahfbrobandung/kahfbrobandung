import { useState, useEffect, useCallback, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import HomePage from '@/pages/Home';
import OperationsPage from '@/pages/Operations';
import DailySalesReport from '@/pages/DailySalesReport';
import LoginPage from '@/pages/Login';
import OnboardingPage from '@/pages/Onboarding';
import ResetPasswordPage from '@/pages/ResetPassword';
import SubscriptionPage from '@/pages/Subscription';
import { supabase } from './supabase';
import {
  ENFORCE_SUBSCRIPTION,
  hasAccess,
  resolveStatus,
  type EffectiveStatus,
  type SubRow,
} from '@/lib/subscription';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const LOCKED_RECHECK_MS = 10_000;

function Router() {
  const [session, setSession] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [hasStore, setHasStore] = useState<boolean | null>(null);

  // Status langganan (hanya diperiksa jika ENFORCE_SUBSCRIPTION aktif)
  const [subStatus, setSubStatus] = useState<EffectiveStatus | null>(null);
  const [subCheckFailed, setSubCheckFailed] = useState(false);
  const activeUserId = useRef<string | null>(null);

  const userId: string | null = session?.user?.id ?? null;

  useEffect(() => {
    // 1. Cek Sesi Login
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoadingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // 2. Cek Toko LANGSUNG KE SUPABASE
    if (session?.user?.id) {
      setHasStore(null);
      supabase
        .from('stores')
        .select('id')
        .eq('user_id', session.user.id)
        .limit(1)
        .then(({ data, error }) => {
          if (error) {
            console.error("Gagal cek toko dari Supabase:", error.message);
            setHasStore(false);
          } else {
            setHasStore(data && data.length > 0);
          }
        });
    } else {
      setHasStore(null);
    }
  }, [session]);

  // 3. Cek langganan LANGSUNG KE SUPABASE (hanya jika guard dinyalakan)
  const checkSubscription = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle();

    // Abaikan hasil jika pengguna sudah berganti akun selama permintaan berjalan
    if (activeUserId.current !== uid) return;

    if (error) {
      // Gagal cek (mis. jaringan): jangan kunci pengguna. Guard ini hanya
      // untuk pengalaman pengguna; penegakan sebenarnya ada di API.
      console.error("Gagal cek langganan dari Supabase:", error.message);
      setSubCheckFailed(true);
      return;
    }
    setSubCheckFailed(false);
    setSubStatus(resolveStatus((data as SubRow | null) ?? null, Date.now()).status);
  }, []);

  useEffect(() => {
    if (!ENFORCE_SUBSCRIPTION || !userId || hasStore !== true) {
      activeUserId.current = null;
      setSubStatus(null);
      setSubCheckFailed(false);
      return;
    }
    activeUserId.current = userId;
    setSubStatus(null);
    setSubCheckFailed(false);
    void checkSubscription(userId);
  }, [userId, hasStore, checkSubscription]);

  const checking =
    ENFORCE_SUBSCRIPTION && hasStore === true && subStatus === null && !subCheckFailed;
  const locked =
    ENFORCE_SUBSCRIPTION &&
    hasStore === true &&
    !subCheckFailed &&
    subStatus !== null &&
    !hasAccess(subStatus);

  // Selama terkunci, cek ulang berkala dan saat tab kembali terlihat,
  // supaya pengguna otomatis terbuka begitu pembayarannya aktif.
  useEffect(() => {
    if (!locked || !userId) return;
    const recheck = () => {
      if (document.visibilityState === 'visible') void checkSubscription(userId);
    };
    const id = window.setInterval(recheck, LOCKED_RECHECK_MS);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [locked, userId, checkSubscription]);

  // Tampilan Loading Awal (Cek Sesi)
  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center font-medium bg-slate-50 dark:bg-slate-950 text-sky-600">
        Memuat Sesi...
      </div>
    );
  }

  // Jika Belum Login
  if (!session) {
    return (
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route><Redirect to="/login" /></Route>
      </Switch>
    );
  }

  // Loading Cek Toko
  if (hasStore === null) {
    return (
      <div className="min-h-screen flex items-center justify-center font-medium text-slate-500 bg-slate-50 dark:bg-slate-950">
        Memeriksa Data Toko...
      </div>
    );
  }

  // Jika User Belum Punya Toko (Paksa ke Onboarding)
  if (hasStore === false) {
    return (
      <Switch>
        <Route path="/onboarding" component={OnboardingPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route><Redirect to="/onboarding" /></Route>
      </Switch>
    );
  }

  // Loading Cek Langganan
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center font-medium text-slate-500 bg-slate-50 dark:bg-slate-950">
        Memeriksa Langganan...
      </div>
    );
  }

  // Langganan tidak aktif: hanya halaman Langganan yang bisa dibuka
  if (locked) {
    return (
      <>
        <button
          type="button"
          onClick={() => void supabase.auth.signOut()}
          className="fixed top-3 right-3 z-50 px-3 py-1.5 rounded-lg bg-white/90 text-slate-700 text-xs font-semibold shadow"
        >
          Keluar
        </button>
        <Switch>
          <Route path="/subscription" component={SubscriptionPage} />
          <Route path="/reset-password" component={ResetPasswordPage} />
          <Route><Redirect to="/subscription" /></Route>
        </Switch>
      </>
    );
  }

  // Jika User Sudah Punya Toko (Halaman Utama)
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/operasional" component={OperationsPage} />
      <Route path="/dashboard" component={DailySalesReport} />
      <Route path="/subscription" component={SubscriptionPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/login"><Redirect to="/" /></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter hook={useHashLocation}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;