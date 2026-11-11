import { useState, useEffect } from 'react';
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
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';

// 1. Arahkan ke backend Vercel (Hanya untuk API data, BUKAN untuk cek toko)
setBaseUrl('https://kahfbrobandung-7qyj.vercel.app');

// 2. Ambil token login dari Supabase secara otomatis
setAuthTokenGetter(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  const [session, setSession] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [hasStore, setHasStore] = useState<boolean | null>(null);
  const [, setLocation] = useLocation();

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
    // 2. Cek Toko LANGSUNG KE SUPABASE (Bypass Vercel agar cepat & anti-lemot)
    if (session?.user?.id) {
      supabase
        .from('stores')
        .select('id')
        .eq('user_id', session.user.id)
        .limit(1)
        .then(({ data, error }) => {
          if (!error) {
            setHasStore(data && data.length > 0);
          } else {
            setHasStore(false); // Jika error, anggap belum punya toko
          }
        });
    } else {
      setHasStore(null); // Reset jika logout
    }
  }, [session]);

  // Tampilan Loading Awal (Cek Sesi)
  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center font-medium bg-slate-50 dark:bg-slate-950">
        Memuat...
      </div>
    );
  }

  // Jika Belum Login
  if (!session) {
    return (
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route>
          {() => {
            setLocation('/login');
            return null;
          }}
        </Route>
      </Switch>
    );
  }

  // Loading Cek Toko (Akan sangat cepat karena langsung ke Supabase)
  if (hasStore === null) {
    return (
      <div className="min-h-screen flex items-center justify-center font-medium text-slate-500 bg-slate-50 dark:bg-slate-950">
        Memuat data...
      </div>
    );
  }

  // Jika User Belum Punya Toko (Paksa ke Onboarding)
  if (hasStore === false) {
    return (
      <Switch>
        <Route path="/onboarding" component={OnboardingPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route>
          {() => {
            setLocation('/onboarding');
            return null;
          }}
        </Route>
      </Switch>
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
      <Route path="/login">
        {() => {
          setLocation('/');
          return null;
        }}
      </Route>
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