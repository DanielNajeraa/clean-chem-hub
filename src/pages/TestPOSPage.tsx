import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Minus, Image as ImageIcon, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useProductImageUrls } from "@/hooks/use-product-image-urls";
import { TestSaleTicketDialog } from "@/components/TestSaleTicket";

type Preset = "granel" | "1L" | "5L" | "20L" | "pieza";

type CartLine = {
  key: string;
  product_id: string;
  product_name: string;
  presentation: Preset;
  quantity: number;
  liters_per_unit: number; // for stock computation on liquids; 0 for piezas
  unit_price: number;
  subtotal: number;
};

const litersFor = (p: Preset) => p === "1L" ? 1 : p === "5L" ? 5 : p === "20L" ? 20 : 0;

export default function TestPOSPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"litro" | "pieza">("litro");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<string>("none");
  const [payment, setPayment] = useState<string>("efectivo");
  const [discount, setDiscount] = useState<number>(0);
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);
  const [ticketOpen, setTicketOpen] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["test_products_pos"],
    queryFn: async () => {
      const { data } = await supabase.from("test_products").select("*").eq("active", true).order("name");
      return data ?? [];
    },
  });
  const { urls: imgUrls, refreshImage } = useProductImageUrls(products);
  const { data: customers = [] } = useQuery({
    queryKey: ["customers_test_pos"],
    queryFn: async () => (await supabase.from("customers").select("id,name")).data ?? [],
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter((p: any) =>
      p.unit_type === tab &&
      (!q || p.name.toLowerCase().includes(q) || (p.category ?? "").toLowerCase().includes(q))
    );
  }, [products, tab, search]);

  const addLiquid = (p: any, pres: Exclude<Preset, "pieza">) => {
    const priceMap: Record<string, number> = {
      granel: Number(p.price_granel), "1L": Number(p.price_1l),
      "5L": Number(p.price_5l), "20L": Number(p.price_20l),
    };
    const price = priceMap[pres] || 0;
    if (price <= 0) return toast.error("Sin precio configurado para esta presentación");
    const lpu = litersFor(pres);
    // for granel default 1L per unit; user can edit qty (in liters)
    const key = `${p.id}-${pres}`;
    setCart((c) => {
      const idx = c.findIndex((l) => l.key === key);
      if (idx >= 0) {
        const copy = [...c];
        copy[idx].quantity += 1;
        copy[idx].subtotal = copy[idx].quantity * copy[idx].unit_price;
        return copy;
      }
      return [...c, {
        key, product_id: p.id, product_name: p.name, presentation: pres,
        quantity: 1, liters_per_unit: pres === "granel" ? 1 : lpu,
        unit_price: price, subtotal: price,
      }];
    });
  };
  const addPiece = (p: any) => {
    const price = Number(p.price_pieza);
    if (price <= 0) return toast.error("Sin precio configurado");
    const key = `${p.id}-pieza`;
    setCart((c) => {
      const idx = c.findIndex((l) => l.key === key);
      if (idx >= 0) {
        const copy = [...c];
        copy[idx].quantity += 1;
        copy[idx].subtotal = copy[idx].quantity * copy[idx].unit_price;
        return copy;
      }
      return [...c, {
        key, product_id: p.id, product_name: p.name, presentation: "pieza",
        quantity: 1, liters_per_unit: 0, unit_price: price, subtotal: price,
      }];
    });
  };
  const updateQty = (key: string, q: number) => {
    setCart((c) => c.map((l) => l.key === key ? { ...l, quantity: q, subtotal: q * l.unit_price } : l).filter((l) => l.quantity > 0));
  };
  const remove = (key: string) => setCart((c) => c.filter((l) => l.key !== key));

  const subtotal = cart.reduce((s, l) => s + l.subtotal, 0);
  const total = Math.max(subtotal - Number(discount || 0), 0);

  const finalize = async () => {
    if (cart.length === 0) return toast.error("Carrito vacío");
    // stock validation
    const byProduct: Record<string, { name: string; needed: number; unit: string }> = {};
    for (const l of cart) {
      const p = products.find((x: any) => x.id === l.product_id);
      if (!p) continue;
      const needed = p.unit_type === "litro" ? l.quantity * l.liters_per_unit : l.quantity;
      byProduct[l.product_id] = byProduct[l.product_id]
        ? { ...byProduct[l.product_id], needed: byProduct[l.product_id].needed + needed }
        : { name: p.name, needed, unit: p.unit_type === "litro" ? "L" : "pz" };
    }
    for (const pid of Object.keys(byProduct)) {
      const p: any = products.find((x: any) => x.id === pid);
      if (!p) continue;
      if (Number(p.stock) < byProduct[pid].needed) {
        return toast.error(`Stock insuficiente: ${byProduct[pid].name} (${Number(p.stock)}${byProduct[pid].unit} disp, ${byProduct[pid].needed}${byProduct[pid].unit} req)`);
      }
    }

    const is_credit = payment === "credito";
    const { data: sale, error } = await supabase.from("test_sales").insert({
      customer_id: customer === "none" ? null : customer,
      user_id: user?.id ?? null,
      payment_method: payment,
      subtotal, discount: Number(discount || 0), total,
      amount_paid: is_credit ? 0 : total,
      payment_status: is_credit ? "pending" : "paid",
      is_credit,
    }).select("id").single();
    if (error || !sale) return toast.error(error?.message ?? "Error");

    const items = cart.map((l) => ({
      sale_id: sale.id, product_id: l.product_id, product_name: l.product_name,
      presentation: l.presentation, quantity: l.quantity,
      unit_price: l.unit_price, subtotal: l.subtotal,
    }));
    const { error: iErr } = await supabase.from("test_sale_items").insert(items);
    if (iErr) return toast.error(iErr.message);

    // Update stock
    for (const pid of Object.keys(byProduct)) {
      const p: any = products.find((x: any) => x.id === pid);
      if (!p) continue;
      await supabase.from("test_products").update({ stock: Number(p.stock) - byProduct[pid].needed }).eq("id", pid);
    }

    toast.success("Venta registrada");
    setLastSaleId(sale.id);
    setTicketOpen(true);
    setCart([]);
    setDiscount(0);
    setCustomer("none");
    setPayment("efectivo");
    qc.invalidateQueries({ queryKey: ["test_products_pos"] });
    qc.invalidateQueries({ queryKey: ["test_products"] });
    qc.invalidateQueries({ queryKey: ["test_sales_list"] });
  };

  return (
    <div>
      <PageHeader title="POS (versión prueba)" subtitle="Venta directa con productos de alta manual · ticket 58 mm" />

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <div className="flex items-center gap-3">
              <TabsList>
                <TabsTrigger value="litro">Líquidos</TabsTrigger>
                <TabsTrigger value="pieza">Piezas</TabsTrigger>
              </TabsList>
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>

            <TabsContent value="litro" className="mt-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((p: any) => (
                  <Card key={p.id} className="p-3">
                    <div className="flex gap-3">
                      {imgUrls[p.id]
                        ? <img src={imgUrls[p.id]} alt={p.name} className="h-16 w-16 rounded object-cover" onError={() => refreshImage(p.id)} />
                        : <div className="flex h-16 w-16 items-center justify-center rounded bg-muted"><ImageIcon className="h-5 w-5 text-muted-foreground" /></div>}
                      <div className="flex-1">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.category}</div>
                        <div className="text-xs mt-1">Stock: <b>{Number(p.stock)} L</b></div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-1">
                      {(["granel","1L","5L","20L"] as const).map((pres) => {
                        const price = pres === "granel" ? p.price_granel : pres === "1L" ? p.price_1l : pres === "5L" ? p.price_5l : p.price_20l;
                        return (
                          <Button key={pres} size="sm" variant="outline" disabled={!Number(price)}
                            onClick={() => addLiquid(p, pres)} className="justify-between">
                            <span>{pres}</span>
                            <span className="text-xs">${Number(price).toFixed(2)}</span>
                          </Button>
                        );
                      })}
                    </div>
                  </Card>
                ))}
                {filtered.length === 0 && <div className="text-sm text-muted-foreground">Sin productos.</div>}
              </div>
            </TabsContent>

            <TabsContent value="pieza" className="mt-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {filtered.map((p: any) => (
                  <Card key={p.id} className="p-3 cursor-pointer hover:border-primary" onClick={() => addPiece(p)}>
                    {imgUrls[p.id]
                      ? <img src={imgUrls[p.id]} alt={p.name} className="h-24 w-full rounded object-cover" onError={() => refreshImage(p.id)} />
                      : <div className="flex h-24 items-center justify-center rounded bg-muted"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>}
                    <div className="mt-2 font-medium text-sm">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.category}</div>
                    <div className="mt-1 flex items-center justify-between">
                      <Badge variant="outline">{Number(p.stock)} pz</Badge>
                      <span className="font-semibold">${Number(p.price_pieza).toFixed(2)}</span>
                    </div>
                  </Card>
                ))}
                {filtered.length === 0 && <div className="text-sm text-muted-foreground">Sin productos.</div>}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <Card className="p-4 h-fit sticky top-4">
          <h3 className="font-semibold mb-3">Carrito</h3>
          <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
            {cart.length === 0 && <div className="text-sm text-muted-foreground">Vacío.</div>}
            {cart.map((l) => (
              <div key={l.key} className="border rounded p-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="font-medium">{l.product_name}</div>
                    <div className="text-xs text-muted-foreground">{l.presentation} · ${l.unit_price.toFixed(2)}</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => remove(l.key)}><Trash2 className="h-3 w-3" /></Button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(l.key, Math.max(0, l.quantity - (l.presentation === "granel" ? 0.5 : 1)))}><Minus className="h-3 w-3" /></Button>
                  <Input className="h-7 text-center" type="number" step="0.01" value={l.quantity}
                    onChange={(e) => updateQty(l.key, Number(e.target.value) || 0)} />
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(l.key, l.quantity + (l.presentation === "granel" ? 0.5 : 1))}><Plus className="h-3 w-3" /></Button>
                  <div className="ml-auto font-semibold">${l.subtotal.toFixed(2)}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-2 border-t pt-3">
            <div><Label className="text-xs">Cliente</Label>
              <Select value={customer} onValueChange={setCustomer}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Público general</SelectItem>
                  {customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Método de pago</Label>
              <Select value={payment} onValueChange={setPayment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="tarjeta">Tarjeta</SelectItem>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
                  <SelectItem value="credito">Crédito (pagar después)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Descuento</Label>
              <Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} /></div>
            <div className="flex justify-between text-sm"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between text-sm"><span>Descuento</span><span>-${Number(discount).toFixed(2)}</span></div>
            <div className="flex justify-between font-bold text-lg"><span>Total</span><span>${total.toFixed(2)}</span></div>
            <Button className="w-full" onClick={finalize} disabled={cart.length === 0}>Cobrar</Button>
          </div>
        </Card>
      </div>

      <TestSaleTicketDialog saleId={lastSaleId} open={ticketOpen} onOpenChange={setTicketOpen} />
    </div>
  );
}
