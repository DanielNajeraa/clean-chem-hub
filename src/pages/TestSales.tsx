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
import { Badge } from "@/components/ui/badge";
import { Eye, DollarSign, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import { TestSaleTicketDialog, PAYMENT_LABELS, saleFolio } from "@/components/TestSaleTicket";

type RangeKind = "today" | "yesterday" | "week" | "month" | "year" | "custom" | "all";

function statusBadge(s: any) {
  if (!s.is_credit) return <Badge variant="secondary">Pagada</Badge>;
  if (s.payment_status === "paid") return <Badge className="bg-success text-success-foreground">Crédito pagado</Badge>;
  if (s.payment_status === "partial") return <Badge className="bg-warning text-warning-foreground">Parcial</Badge>;
  return <Badge variant="destructive">Pendiente</Badge>;
}

export default function TestSales() {
  const qc = useQueryClient();
  const [range, setRange] = useState<RangeKind>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [statusF, setStatusF] = useState("all"); // all|paid|credit_pending|credit_done
  const [search, setSearch] = useState("");
  const [view, setView] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [abonoSale, setAbonoSale] = useState<any | null>(null);
  const [abonoAmount, setAbonoAmount] = useState(0);

  const fromDate = useMemo(() => {
    const d = new Date();
    if (range === "today") { d.setHours(0,0,0,0); return d; }
    if (range === "yesterday") { d.setDate(d.getDate()-1); d.setHours(0,0,0,0); return d; }
    if (range === "week") { d.setDate(d.getDate()-7); return d; }
    if (range === "month") { d.setDate(1); d.setHours(0,0,0,0); return d; }
    if (range === "year") { d.setMonth(0,1); d.setHours(0,0,0,0); return d; }
    if (range === "custom" && customFrom) return new Date(customFrom + "T00:00:00");
    return null;
  }, [range, customFrom]);

  const toDate = useMemo(() => {
    if (range === "yesterday") { const d = new Date(); d.setDate(d.getDate()-1); d.setHours(23,59,59,999); return d; }
    if (range === "custom" && customTo) return new Date(customTo + "T23:59:59");
    return null;
  }, [range, customTo]);

  const { data: rawSales = [] } = useQuery({
    queryKey: ["test_sales_list", range, customFrom, customTo],
    queryFn: async () => {
      let q = supabase.from("test_sales")
        .select("*, customers(name), test_sale_items(id)")
        .order("created_at", { ascending: false }).limit(500);
      if (fromDate) q = q.gte("created_at", fromDate.toISOString());
      if (toDate) q = q.lte("created_at", toDate.toISOString());
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // test_sales.user_id points to auth.users, so seller names are looked up separately.
  const userIds = useMemo(() => [...new Set(rawSales.map((s: any) => s.user_id).filter(Boolean))].sort(), [rawSales]);
  const { data: sellers = {} } = useQuery({
    enabled: userIds.length > 0,
    queryKey: ["test_sales_sellers", userIds],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", userIds);
      return Object.fromEntries((data ?? []).map((p: any) => [p.id, p.full_name || p.email]));
    },
  });

  const sales = useMemo(() => {
    const q = search.trim().replace(/^#/, "").toLowerCase();
    return rawSales.filter((s: any) => {
      if (statusF === "paid" && s.is_credit) return false;
      if (statusF === "credit_pending" && !(s.is_credit && s.payment_status !== "paid")) return false;
      if (statusF === "credit_done" && !(s.is_credit && s.payment_status === "paid")) return false;
      if (!q) return true;
      return s.id.toLowerCase().includes(q) || (s.customers?.name ?? "").toLowerCase().includes(q);
    });
  }, [rawSales, statusF, search]);

  const { data: detail } = useQuery({
    enabled: !!view,
    queryKey: ["test_sale_detail", view],
    queryFn: async () => {
      const [sale, items] = await Promise.all([
        supabase.from("test_sales").select("*, customers(name,phone)").eq("id", view!).single(),
        supabase.from("test_sale_items").select("*").eq("sale_id", view!).order("created_at"),
      ]);
      return { sale: sale.data, items: items.data ?? [] };
    },
  });

  const totals = useMemo(() => {
    const totalMoney = sales.reduce((s: number, x: any) => s + Number(x.total), 0);
    const paid = sales.reduce((s: number, x: any) => s + Number(x.amount_paid ?? 0), 0);
    const pending = sales
      .filter((x: any) => x.is_credit && x.payment_status !== "paid")
      .reduce((s: number, x: any) => s + (Number(x.total) - Number(x.amount_paid ?? 0)), 0);
    const byPay: Record<string, number> = {};
    sales.forEach((x: any) => { byPay[x.payment_method] = (byPay[x.payment_method] ?? 0) + Number(x.total); });
    return { totalMoney, paid, pending, byPay };
  }, [sales]);

  const submitAbono = async () => {
    if (!abonoSale || abonoAmount <= 0) return;
    const newPaid = Math.min(Number(abonoSale.amount_paid ?? 0) + abonoAmount, Number(abonoSale.total));
    const { error } = await supabase.from("test_sales").update({
      amount_paid: newPaid,
      payment_status: newPaid >= Number(abonoSale.total) ? "paid" : "partial",
    }).eq("id", abonoSale.id);
    if (error) return toast.error(error.message);
    toast.success("Abono registrado");
    setAbonoSale(null);
    setAbonoAmount(0);
    qc.invalidateQueries({ queryKey: ["test_sales_list"] });
    qc.invalidateQueries({ queryKey: ["test_sale_detail"] });
    qc.invalidateQueries({ queryKey: ["test_sale_ticket"] });
  };

  return (
    <div>
      <PageHeader title="Ventas (prueba)" subtitle="Ventas del POS de prueba · consulta, detalle y reimpresión de tickets" />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative w-64">
          <Label className="text-xs">Buscar</Label>
          <Search className="absolute left-2 top-7.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Folio o cliente" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
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
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total vendido</p><p className="text-2xl font-bold">${totals.totalMoney.toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cobrado</p><p className="text-2xl font-bold text-success">${totals.paid.toFixed(2)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pendiente cobro</p><p className="text-2xl font-bold text-destructive">${totals.pending.toFixed(2)}</p></CardContent></Card>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {Object.entries(totals.byPay).map(([k, v]) => <Badge key={k} variant="outline">{PAYMENT_LABELS[k] ?? k}: ${v.toFixed(2)}</Badge>)}
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Folio</TableHead><TableHead>Fecha</TableHead><TableHead>Vendedor</TableHead>
            <TableHead>Cliente</TableHead><TableHead className="text-center">Prod.</TableHead><TableHead>Pago</TableHead>
            <TableHead>Estado</TableHead><TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Saldo</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {sales.map((s: any) => {
              const saldo = Number(s.total) - Number(s.amount_paid ?? 0);
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs font-semibold">#{saleFolio(s.id)}</TableCell>
                  <TableCell className="text-xs">{new Date(s.created_at).toLocaleString("es-MX")}</TableCell>
                  <TableCell className="text-xs">{(s.user_id && sellers[s.user_id]) || "—"}</TableCell>
                  <TableCell>{s.customers?.name ?? "Público general"}</TableCell>
                  <TableCell className="text-center">{s.test_sale_items?.length ?? 0}</TableCell>
                  <TableCell>{PAYMENT_LABELS[s.payment_method] ?? s.payment_method}</TableCell>
                  <TableCell>{statusBadge(s)}</TableCell>
                  <TableCell className="text-right font-semibold">${Number(s.total).toFixed(2)}</TableCell>
                  <TableCell className={`text-right ${saldo > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>${saldo.toFixed(2)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {s.is_credit && s.payment_status !== "paid" && (
                      <Button size="sm" variant="outline" onClick={() => { setAbonoSale(s); setAbonoAmount(saldo); }}><DollarSign className="mr-1 h-3 w-3" />Abonar</Button>
                    )}
                    <Button size="sm" variant="ghost" title="Ver detalle" onClick={() => setView(s.id)}><Eye className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" title="Ver / imprimir ticket" onClick={() => setTicketId(s.id)}><Printer className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {sales.length === 0 && (
              <TableRow><TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">Sin ventas en este periodo.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Detalle de venta {view ? `#${saleFolio(view)}` : ""}</DialogTitle></DialogHeader>
          {detail?.sale && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{new Date(detail.sale.created_at).toLocaleString("es-MX")}</span>
                {statusBadge(detail.sale)}
              </div>
              <div className="grid gap-1 text-sm sm:grid-cols-3">
                <p><span className="text-muted-foreground">Cliente: </span>{detail.sale.customers?.name ?? "Público general"}</p>
                <p><span className="text-muted-foreground">Pago: </span>{PAYMENT_LABELS[detail.sale.payment_method] ?? detail.sale.payment_method}</p>
                <p><span className="text-muted-foreground">Vendedor: </span>{(detail.sale.user_id && sellers[detail.sale.user_id]) || "—"}</p>
              </div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Producto</TableHead><TableHead>Presentación</TableHead>
                  <TableHead className="text-right">Cant.</TableHead><TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {detail.items.map((i: any) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.product_name}</TableCell>
                      <TableCell><Badge variant="outline">{i.presentation}</Badge></TableCell>
                      <TableCell className="text-right">{Number(i.quantity)}</TableCell>
                      <TableCell className="text-right">${Number(i.unit_price).toFixed(2)}</TableCell>
                      <TableCell className="text-right">${Number(i.subtotal).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="space-y-1 border-t pt-2 text-right">
                <p>Subtotal: ${Number(detail.sale.subtotal).toFixed(2)}</p>
                <p>Descuento: −${Number(detail.sale.discount).toFixed(2)}</p>
                <p className="text-lg font-bold">Total: ${Number(detail.sale.total).toFixed(2)}</p>
                {detail.sale.is_credit && (
                  <>
                    <p className="text-success">Pagado: ${Number(detail.sale.amount_paid ?? 0).toFixed(2)}</p>
                    <p className="font-semibold text-destructive">Saldo: ${(Number(detail.sale.total) - Number(detail.sale.amount_paid ?? 0)).toFixed(2)}</p>
                  </>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setView(null)}>Cerrar</Button>
            <Button onClick={() => { setTicketId(view); setView(null); }}><Printer className="mr-2 h-4 w-4" />Ver / imprimir ticket</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!abonoSale} onOpenChange={(o) => !o && setAbonoSale(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar abono</DialogTitle></DialogHeader>
          {abonoSale && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted p-3 text-sm">
                <p className="font-semibold">#{saleFolio(abonoSale.id)} · {abonoSale.customers?.name ?? "Público general"}</p>
                <p>Total: ${Number(abonoSale.total).toFixed(2)}</p>
                <p>Pagado: ${Number(abonoSale.amount_paid ?? 0).toFixed(2)}</p>
                <p className="font-bold text-destructive">Saldo: ${(Number(abonoSale.total) - Number(abonoSale.amount_paid ?? 0)).toFixed(2)}</p>
              </div>
              <div><Label>Monto</Label><Input type="number" min={0.01} step="0.01" value={abonoAmount} onChange={(e) => setAbonoAmount(parseFloat(e.target.value) || 0)} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbonoSale(null)}>Cancelar</Button>
            <Button onClick={submitAbono}>Registrar abono</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TestSaleTicketDialog saleId={ticketId} open={!!ticketId} onOpenChange={(o) => !o && setTicketId(null)} />
    </div>
  );
}
