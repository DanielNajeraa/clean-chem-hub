import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Minus, Trash2, Search, Printer, Receipt } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/pos")({ component: POS });

type Product = {
  id: string; name: string; price: number; stock: number;
  presentation: string; is_bulk: boolean; unit_type: string;
  image_url: string | null; category_id: string | null;
};
type CartItem = { product_id: string; product_name: string; quantity: number; unit_price: number; is_bulk: boolean; max_stock: number };

function POS() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState<string>("none");
  const [payment, setPayment] = useState("efectivo");
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["pos-products"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("*").order("name");
      return (data ?? []) as Product[];
    },
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("*").order("name")).data ?? [],
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["customers-pos"],
    queryFn: async () => (await supabase.from("customers").select("id,name").order("name")).data ?? [],
  });
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await supabase.from("settings").select("*").single()).data,
  });

  const filtered = useMemo(() => products.filter((p) =>
    (cat === "all" || p.category_id === cat) &&
    p.name.toLowerCase().includes(search.toLowerCase())
  ), [products, search, cat]);

  const addToCart = (p: Product) => {
    if (p.stock <= 0) { toast.error("Sin stock"); return; }
    setCart((c) => {
      const existing = c.find((i) => i.product_id === p.id);
      if (existing) {
        if (existing.quantity + 1 > p.stock) { toast.error("Stock insuficiente"); return c; }
        return c.map((i) => i.product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...c, { product_id: p.id, product_name: p.name, quantity: p.is_bulk ? 1 : 1, unit_price: Number(p.price), is_bulk: p.is_bulk, max_stock: Number(p.stock) }];
    });
  };

  const updateQty = (id: string, qty: number) => {
    setCart((c) => c.map((i) => i.product_id === id ? { ...i, quantity: Math.max(0.01, Math.min(qty, i.max_stock)) } : i));
  };
  const remove = (id: string) => setCart((c) => c.filter((i) => i.product_id !== id));

  const totals = useMemo(() => {
    const subtotal = cart.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const totalUnits = cart.reduce((s, i) => s + i.quantity, 0);
    const threshold = settings?.discount_threshold ?? 3;
    const pct = settings?.discount_percent ?? 5;
    const applyDiscount = totalUnits >= threshold;
    const discount = applyDiscount ? subtotal * (Number(pct) / 100) : 0;
    return { subtotal, discount, total: subtotal - discount, totalUnits, pct, applyDiscount };
  }, [cart, settings]);

  const checkout = async () => {
    if (cart.length === 0) { toast.error("Carrito vacío"); return; }
    if (!user) return;
    setSubmitting(true);
    const items = cart.map((i) => ({
      product_id: i.product_id,
      product_name: i.product_name,
      quantity: i.quantity,
      unit_price: i.unit_price,
      subtotal: i.quantity * i.unit_price,
    }));
    const { data, error } = await supabase.rpc("process_sale", {
      _customer_id: customerId === "none" ? null : customerId,
      _payment_method: payment,
      _subtotal: totals.subtotal,
      _discount: totals.discount,
      _total: totals.total,
      _items: items,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Venta registrada");
    setLastSaleId(data as string);
    setCart([]);
    setCustomerId("none");
    qc.invalidateQueries({ queryKey: ["pos-products"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  return (
    <div>
      <PageHeader title="Punto de Venta" subtitle="Registra ventas, aplica descuentos y genera tickets" />
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        {/* Catalog */}
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Buscar producto..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={cat} onValueChange={setCat}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las categorías</SelectItem>
                {categories.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <ScrollArea className="h-[calc(100vh-260px)] pr-3">
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {filtered.map((p) => (
                <Card key={p.id} className="cursor-pointer overflow-hidden transition hover:border-primary hover:shadow-md" onClick={() => addToCart(p)}>
                  <div className="flex aspect-square items-center justify-center bg-secondary">
                    {p.image_url ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                      : <span className="text-4xl">🧴</span>}
                  </div>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-medium leading-tight line-clamp-2">{p.name}</h3>
                      {p.is_bulk && <Badge variant="secondary" className="shrink-0 bg-warning/20 text-warning-foreground">Granel</Badge>}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="font-bold text-primary">${Number(p.price).toFixed(2)}{p.is_bulk && "/L"}</span>
                      <span className={`text-xs ${p.stock <= 5 ? "text-destructive" : "text-muted-foreground"}`}>Stock: {Number(p.stock)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Cart */}
        <Card className="flex h-[calc(100vh-180px)] flex-col">
          <CardContent className="flex flex-1 flex-col p-4">
            <h3 className="mb-3 text-base font-semibold">Carrito</h3>
            <div className="grid gap-2">
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger><SelectValue placeholder="Cliente (opcional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin cliente</SelectItem>
                  {customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={payment} onValueChange={setPayment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="tarjeta">Tarjeta</SelectItem>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <ScrollArea className="-mx-4 my-3 flex-1 px-4">
              {cart.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Toca un producto para agregarlo</p>
              ) : (
                <ul className="space-y-2">
                  {cart.map((i) => (
                    <li key={i.product_id} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium leading-tight">{i.product_name}</p>
                          <p className="text-xs text-muted-foreground">${i.unit_price.toFixed(2)} {i.is_bulk ? "/L" : "c/u"}</p>
                        </div>
                        <button onClick={() => remove(i.product_id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        {i.is_bulk ? (
                          <div className="flex items-center gap-1">
                            <Input type="number" min={0.1} step={0.1} max={i.max_stock} value={i.quantity}
                              onChange={(e) => updateQty(i.product_id, parseFloat(e.target.value) || 0)} className="h-8 w-20" />
                            <span className="text-xs text-muted-foreground">L</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(i.product_id, i.quantity - 1)}><Minus className="h-3 w-3" /></Button>
                            <span className="w-8 text-center text-sm font-medium">{i.quantity}</span>
                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(i.product_id, i.quantity + 1)}><Plus className="h-3 w-3" /></Button>
                          </div>
                        )}
                        <span className="text-sm font-semibold">${(i.quantity * i.unit_price).toFixed(2)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>

            <div className="space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>${totals.subtotal.toFixed(2)}</span></div>
              {totals.applyDiscount && (
                <div className="flex justify-between text-success"><span>Descuento {totals.pct}% (≥{settings?.discount_threshold ?? 3} uds)</span><span>−${totals.discount.toFixed(2)}</span></div>
              )}
              <div className="flex justify-between text-lg font-bold pt-1"><span>Total</span><span>${totals.total.toFixed(2)}</span></div>
            </div>

            <Button onClick={checkout} disabled={submitting || cart.length === 0}
              className="mt-3 h-12 w-full bg-warning text-warning-foreground hover:bg-warning/90 text-base font-semibold">
              <Receipt className="mr-2 h-5 w-5" /> Cobrar
            </Button>
          </CardContent>
        </Card>
      </div>

      <TicketDialog saleId={lastSaleId} onClose={() => setLastSaleId(null)} />
    </div>
  );
}

function TicketDialog({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const { data } = useQuery({
    enabled: !!saleId,
    queryKey: ["sale", saleId],
    queryFn: async () => {
      const [sale, items, settings] = await Promise.all([
        supabase.from("sales").select("*, customers(name)").eq("id", saleId!).single(),
        supabase.from("sale_items").select("*").eq("sale_id", saleId!),
        supabase.from("settings").select("*").single(),
      ]);
      return { sale: sale.data, items: items.data ?? [], settings: settings.data };
    },
  });
  return (
    <Dialog open={!!saleId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Ticket de venta</DialogTitle></DialogHeader>
        {data?.sale && (
          <div id="ticket-print" className="space-y-2 font-mono text-xs">
            <div className="text-center">
              <p className="text-base font-bold">{data.settings?.business_name}</p>
              <p>{data.settings?.address}</p>
              <p>{data.settings?.phone}</p>
            </div>
            <div className="border-t border-dashed pt-2">
              <p>Fecha: {new Date(data.sale.created_at).toLocaleString()}</p>
              <p>Cliente: {(data.sale as any).customers?.name ?? "—"}</p>
              <p>Pago: {data.sale.payment_method}</p>
            </div>
            <table className="w-full border-t border-dashed pt-2">
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id}><td>{i.quantity} × {i.product_name}</td><td className="text-right">${Number(i.subtotal).toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-dashed pt-2">
              <div className="flex justify-between"><span>Subtotal</span><span>${Number(data.sale.subtotal).toFixed(2)}</span></div>
              {Number(data.sale.discount) > 0 && <div className="flex justify-between"><span>Descuento</span><span>−${Number(data.sale.discount).toFixed(2)}</span></div>}
              <div className="flex justify-between text-base font-bold"><span>TOTAL</span><span>${Number(data.sale.total).toFixed(2)}</span></div>
            </div>
            <p className="pt-2 text-center">¡Gracias por tu compra!</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Imprimir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
