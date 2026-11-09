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
import { supabase } from './supabase';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { setAuthTokenGetter, setBaseUrl, useListStores } from '@workspace/api-client-react';

// 1. Arahkan ke backend Vercel
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
  const [loading, setLoading] = useState(true);
  const [, setLocation] = useLocation();

  // Cek daftar toko user
  const storesQuery = useListStores({
    query: { enabled: !!session }
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Loading awal (mengecek sesi login)
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center font-medium">Memuat...</div>;
  }

  // Jika belum login, arahkan ke halaman Login
  if (!session) {
    return (
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route>
          {() => {
            setLocation('/login');
            return null;
          }}
        </Route>
      </Switch>
    );
  }

  // PERBAIKAN: Tampilkan loading saat mengecek toko agar tidak "berkedip"
  if (storesQuery.isLoading) {
    return <div className="min-h-screen flex items-center justify-center font-medium text-slate-500">Mengecek data toko...</div>;
  }

  // Jika sudah login tapi belum punya toko, paksa ke Onboarding
  if (storesQuery.isSuccess && storesQuery.data.length === 0) {
    return (
      <Switch>
        <Route path="/onboarding" component={OnboardingPage} />
        <Route>
          {() => {
            setLocation('/onboarding');
            return null;
          }}
        </Route>
      </Switch>
    );
  }

  // Jika sudah punya toko, tampilkan halaman utama
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/operasional" component={OperationsPage} />
      <Route path="/dashboard" component={DailySalesReport} />
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