import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import HomePage from '@/pages/Home';
import OperationsPage from '@/pages/Operations';
import DailySalesReport from '@/pages/DailySalesReport';
import { Route, Switch, Router as WouterRouter } from 'wouter';
// INI BAGIAN YANG DIPERBAIKI (PAKAI KURUNG KURAWAL)
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
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/operasional" component={OperationsPage} />
      <Route path="/dashboard" component={DailySalesReport} />
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
