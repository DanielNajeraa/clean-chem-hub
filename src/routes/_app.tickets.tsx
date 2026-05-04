import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Eye } from "lucide-react";

export const Route = createFileRoute("/_app/tickets")({ component: TicketsPage });

function TicketsPage() {
  const [view, setView] = useState<string | null>(null);

  const { data: sales = [] } = useQuery({
    queryKey: ["sales"],
    queryFn: async () => (await supabase.from("sales").select("*, customers(name), profiles(full_name,email)").order("created_at", { ascending: false }).limit(100)).data ?? [],
  });

  const { data: detail } = useQuery({
    enabled: !!view, queryKey: ["sale-detail", view],
    queryFn: async () => {
      const items = (await supabase.from("sale_items").select("*").eq("sale_id", view!)).data ?? [];
      const sale = sales.find((s: any) => s.id === view);
      return { sale, items };
    },
  });

  return (
    <div>
      <PageHeader title="Tickets / Historial de ventas" subtitle="Últimas 100 ventas registradas" />
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fecha</TableHead><TableHead>Cliente</TableHead><TableHead>Pago</TableHead>
            <TableHead>Subtotal</TableHead><TableHead>Descuento</TableHead><TableHead>Total</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {sales.map((s: any) => (
              <TableRow key={s.id}>
                <TableCell className="text-xs">{new Date(s.created_at).toLocaleString()}</TableCell>
                <TableCell>{s.customers?.name ?? "—"}</TableCell>
                <TableCell className="capitalize">{s.payment_method}</TableCell>
                <TableCell>${Number(s.subtotal).toFixed(2)}</TableCell>
                <TableCell>${Number(s.discount).toFixed(2)}</TableCell>
                <TableCell className="font-semibold">${Number(s.total).toFixed(2)}</TableCell>
                <TableCell><Button size="sm" variant="ghost" onClick={() => setView(s.id)}><Eye className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Detalle del ticket</DialogTitle></DialogHeader>
          {detail?.sale && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">{new Date(detail.sale.created_at).toLocaleString()}</div>
              <Table>
                <TableHeader><TableRow><TableHead>Producto</TableHead><TableHead>Cant.</TableHead><TableHead>Precio</TableHead><TableHead>Subtotal</TableHead></TableRow></TableHeader>
                <TableBody>
                  {detail.items.map((i: any) => (
                    <TableRow key={i.id}><TableCell>{i.product_name}</TableCell><TableCell>{Number(i.quantity)}</TableCell><TableCell>${Number(i.unit_price).toFixed(2)}</TableCell><TableCell>${Number(i.subtotal).toFixed(2)}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="border-t pt-2 text-right">
                <p>Subtotal: ${Number(detail.sale.subtotal).toFixed(2)}</p>
                <p>Descuento: −${Number(detail.sale.discount).toFixed(2)}</p>
                <p className="text-lg font-bold">Total: ${Number(detail.sale.total).toFixed(2)}</p>
              </div>
              <Button onClick={() => window.print()} className="w-full">Imprimir</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
