import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatCard } from "@/components/Page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, ShoppingCart, Beaker, Factory } from "lucide-react";
import { useAuth } from "@/lib/auth";

function Dashboard() {
  const { role } = useAuth();
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const today = new Date(); today.setHours(0,0,0,0);
      const [products, sales, lowStock, orders, salesToday] = await Promise.all([
        supabase.from("products").select("*", { count: "exact", head: true }),
        supabase.from("sales").select("total"),
        supabase.from("raw_materials").select("name,stock,reorder_point").lt("stock", 9999),
        supabase.from("production_orders").select("*", { count: "exact", head: true }),
        supabase.from("sales").select("total").gte("created_at", today.toISOString()),
      ]);
      const totalSales = (sales.data ?? []).reduce((a, b) => a + Number(b.total), 0);
      const todaySales = (salesToday.data ?? []).reduce((a, b) => a + Number(b.total), 0);
      const low = (lowStock.data ?? []).filter((m) => Number(m.stock) <= Number(m.reorder_point));
      return {
        products: products.count ?? 0,
        salesCount: sales.data?.length ?? 0,
        totalSales,
        todaySales,
        ordersCount: orders.count ?? 0,
        low,
      };
    },
  });

  return (
    <div>
      <PageHeader title={`Hola 👋`} subtitle={`Resumen general — rol: ${role}`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Productos" value={data?.products ?? "—"} icon={<Package className="h-4 w-4" />} />
        <StatCard label="Ventas hoy" value={`$${(data?.todaySales ?? 0).toFixed(2)}`} accent="success" icon={<ShoppingCart className="h-4 w-4" />} />
        <StatCard label="Total ventas" value={`$${(data?.totalSales ?? 0).toFixed(2)}`} icon={<ShoppingCart className="h-4 w-4" />} />
        <StatCard label="Órdenes producción" value={data?.ordersCount ?? "—"} accent="warning" icon={<Factory className="h-4 w-4" />} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Beaker className="h-4 w-4" /> Materias primas bajo punto de reorden</CardTitle>
        </CardHeader>
        <CardContent>
          {(!data?.low || data.low.length === 0) ? (
            <p className="text-sm text-muted-foreground">Sin alertas. Todo el inventario por encima del mínimo.</p>
          ) : (
            <ul className="divide-y">
              {data.low.map((m) => (
                <li key={m.name} className="flex justify-between py-2 text-sm">
                  <span>{m.name}</span>
                  <span className="font-medium text-destructive">{Number(m.stock)} (mín {Number(m.reorder_point)})</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default Dashboard;
