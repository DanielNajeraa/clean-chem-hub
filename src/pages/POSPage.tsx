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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Trash2, Search, Printer, Receipt, Droplet, Plus, Package, Minus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type StockRow = { product_id: string; product_name: string; total_liters_available: number };
type Presentation = { id: string; product_id: string; label: string; liters: number; price: number; is_bulk: boolean; active: boolean };
type PieceProduct = { id: string; name: string; price: number; stock: number };

type LiquidCartItem = {
  kind: "liquid";
  product_id: string;
  product_name: string;
  presentation_id: string | null;
  presentation_label: string;
  is_bulk: boolean;
  liters_per_unit: number;
  unit_price: number;
  quantity: number;
  total_liters: number;
  subtotal: number;
  dispatch_type: "20L" | "5L" | "4L" | "1L" | "granel" | "otro";
};
type PieceCartItem = {
  kind: "piece";
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
};
type CartItem = LiquidCartItem | PieceCartItem;

const deriveDispatch = (liters_per_unit: number, is_bulk: boolean): LiquidCartItem["dispatch_type"] => {
  if (is_bulk) return "granel";
  if (liters_per_unit === 20) return "20L";
  if (liters_per_unit === 5) return "5L";
  if (liters_per_unit === 4) return "4L";
  if (liters_per_unit === 1) return "1L";
  return "otro";
};

function POS() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [tab, setTab] = useState<"liquidos" | "piezas">("liquidos");
  const [search, setSearch] = useState("");
  const [selProductId, setSelProductId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState<string>("none");
  const [payment, setPayment] = useState("efectivo");
  const [lastSale, setLastSale] = useState<{ id: string; kind: "liquid" | "piece" } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: stock = [] } = useQuery({
    queryKey: ["pos-stock"],
    queryFn: async () => ((await supabase.from("product_stock_liters" as any).select("*").order("product_name")).data ?? []) as unknown as StockRow[],
  });
  const { data: pieces = [] } = useQuery({
    queryKey: ["pos-pieces"],
    queryFn: async () => ((await supabase.from("products").select("id,name,price,stock").eq("unit_type", "pieza").order("name")).data ?? []) as PieceProduct[],
  });
  const { data: presentations = [] } = useQuery({
    enabled: !!selProductId && tab === "liquidos",
    queryKey: ["pos-presentations", selProductId],
    queryFn: async () => ((await supabase.from("product_presentations").select("*").eq("product_id", selProductId!).eq("active", true).order("liters", { ascending: false })).data ?? []) as Presentation[],
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["customers-pos"],
    queryFn: async () => (await supabase.from("customers").select("id,name").order("name")).data ?? [],
  });

  const filteredStock = useMemo(() => stock.filter((p) => p.product_name.toLowerCase().includes(search.toLowerCase())), [stock, search]);
  const filteredPieces = useMemo(() => pieces.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())), [pieces, search]);
  const selectedStock = stock.find((s) => s.product_id === selProductId);

  const addPresentation = (pres: Presentation, qtyOrLiters: number) => {
    if (!selectedStock) return;
    const stockAvail = Number(selectedStock.total_liters_available);
    let liters_per_unit = Number(pres.liters);
    let quantity = qtyOrLiters;
    let total_liters: number;
    let subtotal: number;
    if (pres.is_bulk) {
      total_liters = qtyOrLiters;
      quantity = qtyOrLiters;
      subtotal = qtyOrLiters * Number(pres.price);
      liters_per_unit = qtyOrLiters;
    } else {
      total_liters = liters_per_unit * quantity;
      subtotal = Number(pres.price) * quantity;
    }
    const usedLiters = cart.filter((c): c is LiquidCartItem => c.kind === "liquid" && c.product_id === pres.product_id).reduce((s, c) => s + c.total_liters, 0);
    if (usedLiters + total_liters > stockAvail) {
      toast.error(`Stock insuficiente: ${stockAvail.toFixed(1)}L disponibles, ${(usedLiters + total_liters).toFixed(1)}L solicitados`);
      return;
    }
    setCart((c) => [...c, {
      kind: "liquid",
      product_id: pres.product_id,
      product_name: selectedStock.product_name,
      presentation_id: pres.id,
      presentation_label: pres.label,
      is_bulk: pres.is_bulk,
      liters_per_unit,
      unit_price: Number(pres.price),
      quantity,
      total_liters,
      subtotal,
      dispatch_type: deriveDispatch(Number(pres.liters), pres.is_bulk),
    }]);
    toast.success("Agregado al carrito");
  };

  const addPiece = (p: PieceProduct, qty: number = 1) => {
    const stockN = Number(p.stock);
    const used = cart.filter((c): c is PieceCartItem => c.kind === "piece" && c.product_id === p.id).reduce((s, c) => s + c.quantity, 0);
    if (used + qty > stockN) { toast.error(`Stock insuficiente: ${stockN} disponibles`); return; }
    setCart((c) => {
      const idx = c.findIndex((x) => x.kind === "piece" && x.product_id === p.id);
      if (idx >= 0) {
        const next = [...c];
        const it = next[idx] as PieceCartItem;
        const newQty = it.quantity + qty;
        next[idx] = { ...it, quantity: newQty, subtotal: newQty * it.unit_price };
        return next;
      }
      return [...c, { kind: "piece", product_id: p.id, product_name: p.name, unit_price: Number(p.price), quantity: qty, subtotal: qty * Number(p.price) }];
    });
  };

  const updatePieceQty = (idx: number, delta: number) => {
    setCart((c) => {
      const it = c[idx];
      if (it.kind !== "piece") return c;
      const piece = pieces.find((p) => p.id === it.product_id);
      const newQty = it.quantity + delta;
      if (newQty <= 0) return c.filter((_, i) => i !== idx);
      if (piece && newQty > Number(piece.stock)) { toast.error("Stock insuficiente"); return c; }
      const next = [...c];
      next[idx] = { ...it, quantity: newQty, subtotal: newQty * it.unit_price };
      return next;
    });
  };

  const remove = (idx: number) => setCart((c) => c.filter((_, i) => i !== idx));

  const totals = useMemo(() => {
    const subtotal = cart.reduce((s, i) => s + i.subtotal, 0);
    return { subtotal, discount: 0, total: subtotal };
  }, [cart]);

  const hasLiquid = cart.some((c) => c.kind === "liquid");
  const hasPiece = cart.some((c) => c.kind === "piece");

  const checkout = async () => {
    if (cart.length === 0) { toast.error("Carrito vacío"); return; }
    if (!user) return;
    if (hasLiquid && hasPiece) { toast.error("Procesa por separado: líquidos y piezas en ventas distintas"); return; }
    setSubmitting(true);

    if (hasLiquid) {
      const items = cart.filter((c): c is LiquidCartItem => c.kind === "liquid").map((i) => ({
        product_id: i.product_id, presentation_id: i.presentation_id, liters: i.total_liters,
        unit_price: i.unit_price, subtotal: i.subtotal, dispatch_type: i.dispatch_type,
      }));
      const { data, error } = await supabase.rpc("process_liquid_sale" as any, {
        _customer_id: customerId === "none" ? null : customerId,
        _payment_method: payment, _subtotal: totals.subtotal, _discount: totals.discount, _total: totals.total,
        _items: items as any,
      } as any);
      setSubmitting(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Venta registrada");
      setLastSale({ id: data as string, kind: "liquid" });
    } else {
      const items = cart.filter((c): c is PieceCartItem => c.kind === "piece").map((i) => ({
        product_id: i.product_id, product_name: i.product_name, quantity: i.quantity,
        unit_price: i.unit_price, subtotal: i.subtotal,
      }));
      const { data, error } = await supabase.rpc("process_sale" as any, {
        _customer_id: customerId === "none" ? null : customerId,
        _payment_method: payment, _subtotal: totals.subtotal, _discount: totals.discount, _total: totals.total,
        _items: items as any,
      } as any);
      setSubmitting(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Venta registrada");
      setLastSale({ id: data as string, kind: "piece" });
    }
    setCart([]); setCustomerId("none"); setSelProductId(null);
    qc.invalidateQueries({ queryKey: ["pos-stock"] });
    qc.invalidateQueries({ queryKey: ["pos-pieces"] });
    qc.invalidateQueries({ queryKey: ["product-stock-liters"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  return (
    <div>
      <PageHeader title="Punto de Venta" subtitle="Filtra líquidos (FIFO) o piezas y registra la venta" />
      <div className="grid gap-4 lg:grid-cols-[1fr_440px]">
        <div>
          <Tabs value={tab} onValueChange={(v) => { setTab(v as any); setSelProductId(null); }}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <TabsList>
                <TabsTrigger value="liquidos"><Droplet className="mr-2 h-4 w-4" />Líquidos</TabsTrigger>
                <TabsTrigger value="piezas"><Package className="mr-2 h-4 w-4" />Piezas</TabsTrigger>
              </TabsList>
              <div className="relative flex-1 min-w-[200px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Buscar producto..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>

            <TabsContent value="liquidos">
              <ScrollArea className="h-[calc(100vh-280px)] pr-3">
                <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
                  {filteredStock.map((p) => {
                    const liters = Number(p.total_liters_available);
                    const noStock = liters === 0;
                    const active = selProductId === p.product_id;
                    return (
                      <Card key={p.product_id}
                        className={cn("cursor-pointer transition", active && "border-primary ring-2 ring-primary/30", noStock && "opacity-60")}
                        onClick={() => !noStock && setSelProductId(p.product_id)}>
                        <CardContent className="p-3">
                          <h3 className="text-sm font-semibold leading-tight">{p.product_name}</h3>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="flex items-baseline gap-1">
                              <Droplet className="h-4 w-4 text-primary" />
                              <span className="text-lg font-bold">{liters.toFixed(1)}</span>
                              <span className="text-xs text-muted-foreground">L</span>
                            </div>
                            {noStock && <Badge variant="destructive" className="text-[10px]">Sin stock</Badge>}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {filteredStock.length === 0 && <p className="col-span-full text-sm text-muted-foreground">Sin productos líquidos.</p>}
                </div>

                {selProductId && (
                  <Card className="mt-4 border-primary/30">
                    <CardContent className="p-4">
                      <h3 className="mb-3 font-semibold">Presentaciones — {selectedStock?.product_name}</h3>
                      {presentations.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Este producto no tiene presentaciones activas. Configúralas en Presentaciones.</p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {presentations.map((pres) => <PresentationCard key={pres.id} pres={pres} onAdd={(q) => addPresentation(pres, q)} />)}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="piezas">
              <ScrollArea className="h-[calc(100vh-280px)] pr-3">
                <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
                  {filteredPieces.map((p) => {
                    const stockN = Number(p.stock);
                    const noStock = stockN === 0;
                    return (
                      <Card key={p.id} className={cn("cursor-pointer transition hover:border-primary", noStock && "opacity-60")}
                        onClick={() => !noStock && addPiece(p, 1)}>
                        <CardContent className="p-3">
                          <h3 className="text-sm font-semibold leading-tight">{p.name}</h3>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-lg font-bold">${Number(p.price).toFixed(2)}</span>
                            {noStock ? <Badge variant="destructive" className="text-[10px]">Sin stock</Badge>
                              : <Badge variant="outline" className="text-[10px]">{stockN} pz</Badge>}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {filteredPieces.length === 0 && <p className="col-span-full text-sm text-muted-foreground">Sin productos por pieza.</p>}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

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

            {hasLiquid && hasPiece && (
              <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">Procesa líquidos y piezas en ventas separadas.</p>
            )}

            <ScrollArea className="-mx-4 my-3 flex-1 px-4">
              {cart.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Selecciona productos para agregar</p>
              ) : (
                <ul className="space-y-2">
                  {cart.map((i, idx) => (
                    <li key={idx} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-tight">{i.product_name}</p>
                          {i.kind === "liquid" ? (
                            <p className="text-xs text-muted-foreground">
                              {i.is_bulk ? `${i.total_liters.toFixed(2)} L granel @ $${i.unit_price}/L` : `${i.quantity} × ${i.presentation_label} (${i.total_liters} L)`}
                            </p>
                          ) : (
                            <div className="mt-1 flex items-center gap-1">
                              <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => updatePieceQty(idx, -1)}><Minus className="h-3 w-3" /></Button>
                              <span className="w-8 text-center text-xs font-medium">{i.quantity}</span>
                              <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => updatePieceQty(idx, 1)}><Plus className="h-3 w-3" /></Button>
                              <span className="ml-2 text-xs text-muted-foreground">@ ${i.unit_price.toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                        <button onClick={() => remove(idx)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                      </div>
                      <div className="mt-2 text-right text-sm font-semibold">${i.subtotal.toFixed(2)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>

            <div className="space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between text-lg font-bold"><span>Total</span><span>${totals.total.toFixed(2)}</span></div>
            </div>

            <Button onClick={checkout} disabled={submitting || cart.length === 0 || (hasLiquid && hasPiece)}
              className="mt-3 h-12 w-full bg-warning text-warning-foreground hover:bg-warning/90 text-base font-semibold">
              <Receipt className="mr-2 h-5 w-5" /> Registrar venta
            </Button>
          </CardContent>
        </Card>
      </div>

      <TicketDialog sale={lastSale} onClose={() => setLastSale(null)} />
    </div>
  );
}

function PresentationCard({ pres, onAdd }: { pres: Presentation; onAdd: (q: number) => void }) {
  const [value, setValue] = useState<number>(1);
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold">{pres.label}</p>
          <p className="text-xs text-muted-foreground">{pres.is_bulk ? `$${Number(pres.price).toFixed(2)} / L` : `$${Number(pres.price).toFixed(2)} c/u · ${pres.liters}L`}</p>
        </div>
        {pres.is_bulk && <Badge variant="outline" className="bg-warning/10">Granel</Badge>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Input type="number" min={pres.is_bulk ? 0.1 : 1} step={pres.is_bulk ? 0.1 : 1}
          value={value} onChange={(e) => setValue(parseFloat(e.target.value) || 0)} className="h-9" />
        <span className="text-xs text-muted-foreground">{pres.is_bulk ? "L" : "uds"}</span>
        <Button size="sm" onClick={() => value > 0 && onAdd(value)}><Plus className="h-4 w-4" /></Button>
      </div>
      <div className="mt-1 text-right text-xs font-medium">
        ${(value * Number(pres.price)).toFixed(2)}
      </div>
    </div>
  );
}

function TicketDialog({ sale, onClose }: { sale: { id: string; kind: "liquid" | "piece" } | null; onClose: () => void }) {
  const { data } = useQuery({
    enabled: !!sale,
    queryKey: ["sale-ticket", sale?.id, sale?.kind],
    queryFn: async () => {
      const [saleRes, settings] = await Promise.all([
        supabase.from("sales").select("*, customers(name)").eq("id", sale!.id).single(),
        supabase.from("settings").select("*").single(),
      ]);
      if (sale!.kind === "liquid") {
        const items = await supabase.from("sale_container_items").select("*, products(name)").eq("sale_id", sale!.id);
        return { sale: saleRes.data, liquidItems: items.data ?? [], pieceItems: [], settings: settings.data };
      } else {
        const items = await supabase.from("sale_items").select("*").eq("sale_id", sale!.id);
        return { sale: saleRes.data, liquidItems: [], pieceItems: items.data ?? [], settings: settings.data };
      }
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; type: string; liters: number; subtotal: number }>();
    (data?.liquidItems ?? []).forEach((i: any) => {
      const key = `${i.product_id}-${i.dispatch_type}-${i.unit_price}`;
      const cur = map.get(key);
      if (cur) { cur.liters += Number(i.liters_dispatched); cur.subtotal += Number(i.subtotal); }
      else map.set(key, { name: i.products?.name ?? "", type: i.dispatch_type, liters: Number(i.liters_dispatched), subtotal: Number(i.subtotal) });
    });
    return Array.from(map.values());
  }, [data]);

  return (
    <Dialog open={!!sale} onOpenChange={(o) => !o && onClose()}>
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
                {grouped.map((g, i) => (
                  <tr key={i}>
                    <td>{g.name} · {g.type} ({g.liters.toFixed(2)}L)</td>
                    <td className="text-right">${g.subtotal.toFixed(2)}</td>
                  </tr>
                ))}
                {data.pieceItems.map((i: any) => (
                  <tr key={i.id}>
                    <td>{i.product_name} × {Number(i.quantity)}</td>
                    <td className="text-right">${Number(i.subtotal).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-dashed pt-2">
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

export default POS;
