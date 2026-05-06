import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import AppLayout from "@/components/AppLayout";
import Index from "@/pages/Index";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFound";
import Dashboard from "@/pages/Dashboard";
import POSPage from "@/pages/POSPage";
import Products from "@/pages/Products";
import Formulas from "@/pages/Formulas";
import RawMaterials from "@/pages/RawMaterials";
import Production from "@/pages/Production";
import Customers from "@/pages/Customers";
import Tickets from "@/pages/Tickets";
import Users from "@/pages/Users";
import Settings from "@/pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/pos" element={<POSPage />} />
                <Route path="/products" element={<Products />} />
                <Route path="/formulas" element={<Formulas />} />
                <Route path="/raw-materials" element={<RawMaterials />} />
                <Route path="/production" element={<Production />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/tickets" element={<Tickets />} />
                <Route path="/users" element={<Users />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
            <Toaster richColors position="top-right" />
          </TooltipProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
