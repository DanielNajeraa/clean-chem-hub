import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import beeCleanLogo from "@/assets/bee-clean-logo.png";

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary text-primary-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-xl bg-white p-3">
            <img src={beeCleanLogo} alt="Bee Clean" className="h-16 w-auto object-contain" />
          </div>
          <p className="text-sm opacity-70">Cargando Bee Clean…</p>
        </div>
      </div>
    );
  }
  return <Navigate to={user ? "/dashboard" : "/login"} replace />;
}
