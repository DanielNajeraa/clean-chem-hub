import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";

function TicketsPage() {
  const [view, setView] = useState<string | null>(null);
  const [range, setRange] = useState<"today" | "week" | "month" | "all">("month");

  const { data: sales = [] } = useQuery({
    queryKey: ["sales", range],
    queryFn: async () => {
      let q = supabase.from("sales").select("*, customers(name), profiles(full_name,email)").order("created_at", { ascending: false }).limit(300);
      if (range !== "all") {
        const now = new Date();
        const from = new Date(now);
        if (range === "today") from.setHours(0, 0, 0, 0);
        else if (range === "week") from.setDate(now.getDate() - 7);
        else if (range === "month") from.setMonth(now.getMonth() - 1);
        q = q.gte("created_at", from.toISOString());
      }
      return (await q).data ?? [];
    },
  });

  const { data: detail } = useQuery({
    enabled: !!view, queryKey: ["sale-detail-mixed", view],
    queryFn: async () => {
      const [legacy, liquid] = await Promise.all([
        supabase.from("sale_items").select("*").eq("sale_id", view!),
        supabase.from("sale_container_items").select("*, products(name)").eq("sale_id", view!),
      ]);
      const sale = sales.find((s: any) => s.id === view);
      return { sale, legacy: legacy.data ?? [], liquid: liquid.data ?? [] };
    },
  });

  const totals = useMemo(() => {
    const totalMoney = sales.reduce((s: number, x: any) => s + Number(x.total), 0);
    const byPay: Record<string, number> = {};
    sales.forEach((x: any) => { byPay[x.payment_method] = (byPay[x.payment_method] ?? 0) + Number(x.total); });
    return { totalMoney, byPay };
  }, [sales]);

  return (
    <div>
      <PageHeader title="Historial de ventas" subtitle="Ventas registradas con detalle por garrafón" actions={
        <Select value={range} onValueChange={(v) => setRange(v as any)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hoy</SelectItem>
            <SelectItem value="week">Última semana</SelectItem>
            <SelectItem value="month">Último mes</SelectItem>
            <SelectItem value="all">Todo</SelectItem>
          </SelectContent>
        </Select>
      } />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ventas</p><p className="text-2xl font-bold">{sales.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-bold">${totals.totalMoney.toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Por método</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {Object.entries(totals.byPay).map(([k, v]) => <Badge key={k} variant="outline" className="capitalize">{k}: ${v.toFixed(0)}</Badge>)}
          </div></CardContent></Card>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fecha</TableHead><TableHead>Vendedor</TableHead><TableHead>Cliente</TableHead><TableHead>Pago</TableHead>
            <TableHead>Total</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {sales.map((s: any) => (
              <TableRow key={s.id}>
                <TableCell className="text-xs">{new Date(s.created_at).toLocaleString()}</TableCell>
                <TableCell className="text-xs">{s.profiles?.full_name || s.profiles?.email || "—"}</TableCell>
                <TableCell>{s.customers?.name ?? "—"}</TableCell>
                <TableCell className="capitalize">{s.payment_method}</TableCell>
                <TableCell className="font-semibold">${Number(s.total).toFixed(2)}</TableCell>
                <TableCell><Button size="sm" variant="ghost" onClick={() => setView(s.id)}><Eye className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Detalle del ticket</DialogTitle></DialogHeader>
          {detail?.sale && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">{new Date(detail.sale.created_at).toLocaleString()}</div>
              {detail.liquid.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">Detalle líquido (FIFO)</p>
                  <Table>
                    <TableHeader><TableRow><TableHead>Producto</TableHead><TableHead>Tipo</TableHead><TableHead>Litros</TableHead><TableHead>P. unitario</TableHead><TableHead>Subtotal</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {detail.liquid.map((i: any) => (
                        <TableRow key={i.id}>
                          <TableCell>{i.products?.name}</TableCell>
                          <TableCell><Badge variant="outline">{i.dispatch_type}</Badge></TableCell>
                          <TableCell>{Number(i.liters_dispatched).toFixed(2)} L</TableCell>
                          <TableCell>${Number(i.unit_price).toFixed(2)}</TableCell>
                          <TableCell>${Number(i.subtotal).toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {detail.legacy.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">Items (legado)</p>
                  <Table>
                    <TableHeader><TableRow><TableHead>Producto</TableHead><TableHead>Cant.</TableHead><TableHead>Precio</TableHead><TableHead>Subtotal</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {detail.legacy.map((i: any) => (
                        <TableRow key={i.id}><TableCell>{i.product_name}</TableCell><TableCell>{Number(i.quantity)}</TableCell><TableCell>${Number(i.unit_price).toFixed(2)}</TableCell><TableCell>${Number(i.subtotal).toFixed(2)}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="border-t pt-2 text-right">
                <p>Subtotal: ${Number(detail.sale.subtotal).toFixed(2)}</p>
                <p>Descuento: −${Number(detail.sale.discount).toFixed(2)}</p>
                <p className="text-lg font-bold">Total: ${Number(detail.sale.total).toFixed(2)}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TicketsPage;
