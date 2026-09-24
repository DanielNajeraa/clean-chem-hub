import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saleFolio } from "@/components/TestSaleTicket";

type Presentation = "granel" | "1L" | "5L" | "20L" | "pieza";

type EditLine = {
  key: string;
  product_id: string | null;
  product_name: string;
  presentation: string;
  quantity: number;
  unit_price: number;
};

const PRESENTATIONS: Presentation[] = ["granel", "1L", "5L", "20L", "pieza"];

// Stock units consumed per unit sold; mirrors how TestPOSPage deducts stock.
const stockFactor = (presentation: string) =>
  presentation === "5L" ? 5 : presentation === "20L" ? 20 : 1;

const priceFor = (p: any, pres: Presentation) =>
  Number(
    pres === "granel" ? p.price_granel :
    pres === "1L" ? p.price_1l :
    pres === "5L" ? p.price_5l :
    pres === "20L" ? p.price_20l : p.price_pieza,
  ) || 0;

function stockUsage(lines: { product_id: string | null; presentation: string; quantity: number }[]) {
  const usage: Record<string, number> = {};
  for (const l of lines) {
    if (!l.product_id) continue;
    usage[l.product_id] = (usage[l.product_id] ?? 0) + Number(l.quantity) * stockFactor(l.presentation);
  }
  return usage;
}

// Applies stock deltas (positive = more consumed). Reads fresh stock right before writing.
async function adjustStock(deltas: Record<string, number>) {
  for (const [pid, delta] of Object.entries(deltas)) {
    if (!delta) continue;
    const { data: p } = await supabase.from("test_products").select("stock").eq("id", pid).maybeSingle();
    if (!p) continue; // product was deleted; nothing to restore
    await supabase.from("test_products").update({ stock: Number(p.stock) - delta }).eq("id", pid);
  }
}

export async function deleteTestSale(saleId: string) {
  const { data: items, error: iErr } = await supabase.from("test_sale_items").select("product_id, presentation, quantity").eq("sale_id", saleId);
  if (iErr) throw iErr;
  const { error } = await supabase.from("test_sales").delete().eq("id", saleId);
  if (error) throw error;
  const restore = Object.fromEntries(Object.entries(stockUsage(items ?? [])).map(([pid, used]) => [pid, -used]));
  await adjustStock(restore);
}

export function TestSaleEditDialog({ saleId, onClose, onSaved }: { saleId: string | null; onClose: () => void; onSaved: () => void }) {
  const [lines, setLines] = useState<EditLine[]>([]);
  const [customer, setCustomer] = useState("none");
  const [payment, setPayment] = useState("efectivo");
  const [discount, setDiscount] = useState(0);
  const [addProduct, setAddProduct] = useState("");
  const [addPres, setAddPres] = useState<Presentation>("1L");
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    enabled: !!saleId,
    queryKey: ["test_sale_edit", saleId],
    // Load once per opening; a background refetch would wipe the user's in-progress edits.
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [sale, items] = await Promise.all([
        supabase.from("test_sales").select("*").eq("id", saleId!).single(),
        supabase.from("test_sale_items").select("*").eq("sale_id", saleId!).order("created_at"),
      ]);
      if (sale.error) throw sale.error;
      return { sale: sale.data, items: items.data ?? [] };
    },
  });
  const { data: products = [] } = useQuery({
    enabled: !!saleId,
    queryKey: ["test_products_pos"],
    queryFn: async () => (await supabase.from("test_products").select("*").eq("active", true).order("name")).data ?? [],
  });
  const { data: customers = [] } = useQuery({
    enabled: !!saleId,
    queryKey: ["customers_test_pos"],
    queryFn: async () => (await supabase.from("customers").select("id,name")).data ?? [],
  });

  useEffect(() => {
    if (!data) return;
    setCustomer(data.sale.customer_id ?? "none");
    setPayment(data.sale.payment_method);
    setDiscount(Number(data.sale.discount));
    setLines(data.items.map((i: any) => ({
      key: i.id, product_id: i.product_id, product_name: i.product_name,
      presentation: i.presentation, quantity: Number(i.quantity), unit_price: Number(i.unit_price),
    })));
  }, [data]);

  const selectedProduct: any = products.find((p: any) => p.id === addProduct);
  const presOptions = selectedProduct
    ? PRESENTATIONS.filter((pres) => (selectedProduct.unit_type === "pieza") === (pres === "pieza") && priceFor(selectedProduct, pres) > 0)
    : [];

  const updateLine = (key: string, patch: Partial<EditLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addLine = () => {
    if (!selectedProduct) return;
    const pres = presOptions.includes(addPres) ? addPres : presOptions[0];
    if (!pres) return toast.error("El producto no tiene precio configurado");
    setLines((ls) => [...ls, {
      key: crypto.randomUUID(), product_id: selectedProduct.id, product_name: selectedProduct.name,
      presentation: pres, quantity: 1, unit_price: priceFor(selectedProduct, pres),
    }]);
    setAddProduct("");
  };

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const total = Math.max(subtotal - Number(discount || 0), 0);

  const save = async () => {
    if (!data || !saleId) return;
    const valid = lines.filter((l) => l.quantity > 0);
    if (valid.length === 0) return toast.error("La venta debe tener al menos un producto. Si quieres quitarla, elimínala.");
    if (valid.some((l) => l.unit_price < 0)) return toast.error("Hay precios negativos");

    // Positive delta = the edited sale consumes more stock than before.
    const before = stockUsage(data.items);
    const after = stockUsage(valid);
    const deltas: Record<string, number> = {};
    for (const pid of new Set([...Object.keys(before), ...Object.keys(after)])) {
      deltas[pid] = (after[pid] ?? 0) - (before[pid] ?? 0);
    }
    for (const [pid, delta] of Object.entries(deltas)) {
      if (delta <= 0) continue;
      const p: any = products.find((x: any) => x.id === pid);
      if (p && Number(p.stock) < delta) {
        return toast.error(`Stock insuficiente: ${p.name} (${Number(p.stock)} disp, faltan ${delta - Number(p.stock)})`);
      }
    }

    setSaving(true);
    try {
      const isCredit = payment === "credito";
      const prevPaid = data.sale.is_credit ? Number(data.sale.amount_paid ?? 0) : 0;
      const amountPaid = isCredit ? Math.min(prevPaid, total) : total;
      const { error: sErr } = await supabase.from("test_sales").update({
        customer_id: customer === "none" ? null : customer,
        payment_method: payment,
        subtotal, discount: Number(discount || 0), total,
        is_credit: isCredit,
        amount_paid: amountPaid,
        payment_status: amountPaid >= total ? "paid" : amountPaid > 0 ? "partial" : "pending",
        updated_at: new Date().toISOString(),
      }).eq("id", saleId);
      if (sErr) throw sErr;

      // Insert the new lines before removing the old ones so a failure never leaves the sale empty.
      const { error: insErr } = await supabase.from("test_sale_items").insert(valid.map((l) => ({
        sale_id: saleId, product_id: l.product_id, product_name: l.product_name,
        presentation: l.presentation, quantity: l.quantity,
        unit_price: l.unit_price, subtotal: l.quantity * l.unit_price,
      })));
      if (insErr) throw insErr;
      const { error: delErr } = await supabase.from("test_sale_items").delete().in("id", data.items.map((i: any) => i.id));
      if (delErr) throw delErr;

      await adjustStock(deltas);
      toast.success("Venta actualizada");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo guardar la venta");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!saleId} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Editar venta {saleId ? `#${saleFolio(saleId)}` : ""}</DialogTitle></DialogHeader>
        {!data ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
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
                <Input type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} />
              </div>
            </div>

            <Table>
              <TableHeader><TableRow>
                <TableHead>Producto</TableHead><TableHead>Presentación</TableHead>
                <TableHead className="w-24">Cant.</TableHead><TableHead className="w-28">Precio</TableHead>
                <TableHead className="text-right">Importe</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.key}>
                    <TableCell className="font-medium">{l.product_name}</TableCell>
                    <TableCell>{l.presentation}</TableCell>
                    <TableCell><Input className="h-8" type="number" min={0} step="0.01" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: Number(e.target.value) || 0 })} /></TableCell>
                    <TableCell><Input className="h-8" type="number" min={0} step="0.01" value={l.unit_price} onChange={(e) => updateLine(l.key, { unit_price: Number(e.target.value) || 0 })} /></TableCell>
                    <TableCell className="text-right">${(l.quantity * l.unit_price).toFixed(2)}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))}
                {lines.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">Sin productos.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>

            <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
              <div className="min-w-56 flex-1"><Label className="text-xs">Agregar producto</Label>
                <Select value={addProduct} onValueChange={setAddProduct}>
                  <SelectTrigger><SelectValue placeholder="Selecciona un producto" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-36"><Label className="text-xs">Presentación</Label>
                <Select value={presOptions.includes(addPres) ? addPres : (presOptions[0] ?? "")} onValueChange={(v) => setAddPres(v as Presentation)} disabled={!selectedProduct}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {presOptions.map((pres) => <SelectItem key={pres} value={pres}>{pres} · ${priceFor(selectedProduct, pres).toFixed(2)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={addLine} disabled={!selectedProduct}><Plus className="mr-1 h-4 w-4" />Agregar</Button>
            </div>

            <div className="space-y-1 border-t pt-2 text-right text-sm">
              <p>Subtotal: ${subtotal.toFixed(2)}</p>
              <p>Descuento: −${Number(discount || 0).toFixed(2)}</p>
              <p className="text-lg font-bold">Total: ${total.toFixed(2)}</p>
              {payment === "credito" && data.sale.is_credit && Number(data.sale.amount_paid) > 0 && (
                <p className="text-muted-foreground">Abonado hasta ahora: ${Number(data.sale.amount_paid).toFixed(2)}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Al guardar, el inventario se ajusta automáticamente según las cantidades que cambiaste.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={!data || saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar cambios</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
