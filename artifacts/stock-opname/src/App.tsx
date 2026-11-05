import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import HomePage from '@/pages/Home';
import OperationsPage from '@/pages/Operations';
import DailySalesReport from '@/pages/DailySalesReport';
import AuthPage from '@/pages/Auth'; // Import halaman login
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter'; // Tambah Redirect
import { useHashLocation } from 'wouter/use-hash-location';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  // Cek apakah user sudah login (punya token dari localStorage)
  const isAuthenticated = !!localStorage.getItem("erlangga_token");

  return (
    <Switch>
      {/* Halaman Login/Daftar selalu bisa diakses */}
      <Route path="/auth" component={AuthPage} />
      
      {/* Halaman yang dilindungi (Wajib Login) */}
      <Route path="/">
        {isAuthenticated ? <HomePage /> : <Redirect to="/auth" />}
      </Route>
      <Route path="/operasional">
        {isAuthenticated ? <OperationsPage /> : <Redirect to="/auth" />}
      </Route>
      <Route path="/dashboard">
        {isAuthenticated ? <DailySalesReport /> : <Redirect to="/auth" />}
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
