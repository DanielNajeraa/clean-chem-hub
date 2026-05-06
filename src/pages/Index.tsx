import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Sparkles } from "lucide-react";

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary text-primary-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-success text-success-foreground">
            <Sparkles className="h-7 w-7" />
          </div>
          <p className="text-sm opacity-70">Cargando CleanFab…</p>
        </div>
      </div>
    );
  }
  return <Navigate to={user ? "/dashboard" : "/login"} replace />;
}
