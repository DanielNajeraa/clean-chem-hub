import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type RangeKind = "today" | "yesterday" | "week" | "month" | "year" | "custom" | "all";

function statusBadge(s: any) {
  if (!s.is_credit) return <Badge variant="secondary">Pagada</Badge>;
  if (s.payment_status === "paid") return <Badge className="bg-success text-success-foreground">Crédito pagado</Badge>;
  if (s.payment_status === "partial") return <Badge className="bg-warning text-warning-foreground">Parcial</Badge>;
  return <Badge variant="destructive">Pendiente</Badge>;
}

function TicketsPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKind>("month");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [statusF, setStatusF] = useState<string>("all"); // all|paid|credit_pending|credit_done
  const [abonoSale, setAbonoSale] = useState<any | null>(null);
  const [abonoAmount, setAbonoAmount] = useState<number>(0);
  const [abonoMethod, setAbonoMethod] = useState<string>("efectivo");

  const fromDate = useMemo(() => {
    const now = new Date();
    const d = new Date(now);
    if (range === "today") { d.setHours(0,0,0,0); return d; }
    if (range === "yesterday") { d.setDate(d.getDate()-1); d.setHours(0,0,0,0); return d; }
    if (range === "week") { d.setDate(d.getDate()-7); return d; }
    if (range === "month") { d.setDate(1); d.setHours(0,0,0,0); return d; }
    if (range === "year") { d.setMonth(0,1); d.setHours(0,0,0,0); return d; }
    if (range === "custom" && customFrom) return new Date(customFrom + "T00:00:00");
    return null;
  }, [range, customFrom]);

  const toDate = useMemo(() => {
    if (range === "yesterday") {
      const d = new Date(); d.setDate(d.getDate()-1); d.setHours(23,59,59,999); return d;
    }
    if (range === "custom" && customTo) {
      const d = new Date(customTo + "T23:59:59"); return d;
    }
    return null;
  }, [range, customTo]);

  const { data: sales = [] } = useQuery({
    queryKey: ["sales-tickets", range, customFrom, customTo, statusF],
    queryFn: async () => {
      let q = supabase.from("sales").select("*, customers(name), profiles(full_name,email)").order("created_at", { ascending: false }).limit(500);
      if (fromDate) q = q.gte("created_at", fromDate.toISOString());
      if (toDate) q = q.lte("created_at", toDate.toISOString());
      const data = (await q).data ?? [];
      if (statusF === "paid") return data.filter((s: any) => !s.is_credit);
      if (statusF === "credit_pending") return data.filter((s: any) => s.is_credit && s.payment_status !== "paid");
      if (statusF === "credit_done") return data.filter((s: any) => s.is_credit && s.payment_status === "paid");
      return data;
    },
  });

  const { data: detail } = useQuery({
    enabled: !!view, queryKey: ["sale-detail-mixed", view],
    queryFn: async () => {
      const [legacy, liquid, payments] = await Promise.all([
        supabase.from("sale_items").select("*, raw_materials(name,unit)").eq("sale_id", view!),
        supabase.from("sale_container_items").select("*, products(name)").eq("sale_id", view!),
        supabase.from("credit_payments" as any).select("*").eq("sale_id", view!).order("created_at"),
      ]);
      const all = legacy.data ?? [];
      const sale = sales.find((s: any) => s.id === view);
      return {
        sale,
        legacy: all.filter((i: any) => i.item_type !== "raw_material"),
        rawMaterials: all.filter((i: any) => i.item_type === "raw_material"),
        liquid: liquid.data ?? [],
        payments: payments.data ?? [],
      };
    },
  });

  const totals = useMemo(() => {
    const totalMoney = sales.reduce((s: number, x: any) => s + Number(x.total), 0);
    const paid = sales.reduce((s: number, x: any) => s + Number(x.amount_paid ?? (x.is_credit ? 0 : x.total)), 0);
    const pending = sales.filter((x: any) => x.is_credit && x.payment_status !== "paid").reduce((s: number, x: any) => s + (Number(x.total) - Number(x.amount_paid ?? 0)), 0);
    const byPay: Record<string, number> = {};
    sales.forEach((x: any) => { byPay[x.payment_method] = (byPay[x.payment_method] ?? 0) + Number(x.total); });
    return { totalMoney, byPay, paid, pending };
  }, [sales]);

  const submitAbono = async () => {
    if (!abonoSale || abonoAmount <= 0) return;
    const { error } = await supabase.rpc("register_credit_payment" as any, {
      _sale_id: abonoSale.id, _amount: abonoAmount, _payment_method: abonoMethod,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Abono registrado");
    setAbonoSale(null); setAbonoAmount(0);
    qc.invalidateQueries({ queryKey: ["sales-tickets"] });
    qc.invalidateQueries({ queryKey: ["sale-detail-mixed"] });
  };

  return (
    <div>
      <PageHeader title="Historial de ventas" subtitle="Filtra por periodo y estado de pago" />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div><Label className="text-xs">Periodo</Label>
          <Select value={range} onValueChange={(v) => setRange(v as RangeKind)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hoy</SelectItem>
              <SelectItem value="yesterday">Ayer</SelectItem>
              <SelectItem value="week">Últimos 7 días</SelectItem>
              <SelectItem value="month">Este mes</SelectItem>
              <SelectItem value="year">Este año</SelectItem>
              <SelectItem value="custom">Rango personalizado</SelectItem>
              <SelectItem value="all">Todo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {range === "custom" && (
          <>
            <div><Label className="text-xs">Desde</Label><Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-44" /></div>
            <div><Label className="text-xs">Hasta</Label><Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-44" /></div>
          </>
        )}
        <div><Label className="text-xs">Estado</Label>
          <Select value={statusF} onValueChange={setStatusF}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="paid">Pagadas (contado)</SelectItem>
              <SelectItem value="credit_pending">Crédito pendiente</SelectItem>
              <SelectItem value="credit_done">Crédito liquidado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ventas</p><p className="text-2xl font-bold">{sales.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total facturado</p><p className="text-2xl font-bold">${totals.totalMoney.toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cobrado</p><p className="text-2xl font-bold text-success">${totals.paid.toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pendiente cobro</p><p className="text-2xl font-bold text-destructive">${totals.pending.toFixed(2)}</p></CardContent></Card>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {Object.entries(totals.byPay).map(([k, v]) => <Badge key={k} variant="outline" className="capitalize">{k}: ${v.toFixed(0)}</Badge>)}
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fecha</TableHead><TableHead>Vendedor</TableHead><TableHead>Cliente</TableHead>
            <TableHead>Pago</TableHead><TableHead>Estado</TableHead>
            <TableHead>Total</TableHead><TableHead>Saldo</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {sales.map((s: any) => {
              const saldo = Number(s.total) - Number(s.amount_paid ?? 0);
              return (
                <TableRow key={s.id}>
                  <TableCell className="text-xs">{new Date(s.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{s.profiles?.full_name || s.profiles?.email || "—"}</TableCell>
                  <TableCell>{s.customers?.name ?? "—"}</TableCell>
                  <TableCell className="capitalize">{s.payment_method}</TableCell>
                  <TableCell>{statusBadge(s)}</TableCell>
                  <TableCell className="font-semibold">${Number(s.total).toFixed(2)}</TableCell>
                  <TableCell className={saldo > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>${saldo.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    {s.is_credit && s.payment_status !== "paid" && (
                      <Button size="sm" variant="outline" onClick={() => { setAbonoSale(s); setAbonoAmount(saldo); }}><DollarSign className="h-3 w-3 mr-1" />Abonar</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setView(s.id)}><Eye className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Detalle del ticket</DialogTitle></DialogHeader>
          {detail?.sale && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{new Date(detail.sale.created_at).toLocaleString()}</span>
                {statusBadge(detail.sale)}
              </div>
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
              {detail.rawMaterials.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">Materia prima vendida</p>
                  <Table>
                    <TableHeader><TableRow><TableHead>Materia prima</TableHead><TableHead>Cantidad</TableHead><TableHead>Precio</TableHead><TableHead>Subtotal</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {detail.rawMaterials.map((i: any) => (
                        <TableRow key={i.id}>
                          <TableCell>{i.product_name}</TableCell>
                          <TableCell>{Number(i.quantity)} {i.raw_materials?.unit ?? ""}</TableCell>
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
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">Items (piezas)</p>
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
              {detail.payments.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">Abonos registrados</p>
                  <Table>
                    <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Método</TableHead><TableHead className="text-right">Monto</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {detail.payments.map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs">{new Date(p.created_at).toLocaleString()}</TableCell>
                          <TableCell className="capitalize">{p.payment_method}</TableCell>
                          <TableCell className="text-right font-medium">${Number(p.amount).toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="border-t pt-2 text-right space-y-1">
                <p>Subtotal: ${Number(detail.sale.subtotal).toFixed(2)}</p>
                <p>Descuento: −${Number(detail.sale.discount).toFixed(2)}</p>
                <p className="text-lg font-bold">Total: ${Number(detail.sale.total).toFixed(2)}</p>
                {detail.sale.is_credit && (
                  <>
                    <p className="text-success">Pagado: ${Number(detail.sale.amount_paid ?? 0).toFixed(2)}</p>
                    <p className="text-destructive font-semibold">Saldo: ${(Number(detail.sale.total) - Number(detail.sale.amount_paid ?? 0)).toFixed(2)}</p>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!abonoSale} onOpenChange={(o) => !o && setAbonoSale(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar abono</DialogTitle></DialogHeader>
          {abonoSale && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted p-3 text-sm">
                <p className="font-semibold">{abonoSale.customers?.name ?? "Sin cliente"}</p>
                <p>Total: ${Number(abonoSale.total).toFixed(2)}</p>
                <p>Pagado: ${Number(abonoSale.amount_paid ?? 0).toFixed(2)}</p>
                <p className="font-bold text-destructive">Saldo: ${(Number(abonoSale.total) - Number(abonoSale.amount_paid ?? 0)).toFixed(2)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Monto</Label><Input type="number" min={0.01} step="0.01" value={abonoAmount} onChange={(e) => setAbonoAmount(parseFloat(e.target.value) || 0)} /></div>
                <div><Label>Método</Label>
                  <Select value={abonoMethod} onValueChange={setAbonoMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="efectivo">Efectivo</SelectItem>
                      <SelectItem value="tarjeta">Tarjeta</SelectItem>
                      <SelectItem value="transferencia">Transferencia</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbonoSale(null)}>Cancelar</Button>
            <Button onClick={submitAbono}>Registrar abono</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TicketsPage;
