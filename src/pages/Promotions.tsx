import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Gift, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type Item = { id?: string; product_id: string; quantity: number; unit_type: string };
type PromoForm = {
  id?: string;
  name: string;
  price: number;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
  items: Item[];
};

const empty: PromoForm = { name: "", price: 0, start_date: null, end_date: null, active: true, items: [] };

export default function Promotions() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PromoForm>(empty);

  const { data: promos = [] } = useQuery({
    queryKey: ["promotions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("promotions" as any)
        .select("*, promotion_items(*, products(name, unit_type))")
        .order("created_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products-for-promos"],
    queryFn: async () => (await supabase.from("products").select("id,name,unit_type,price").order("name")).data ?? [],
  });

  const openNew = () => { setForm(empty); setOpen(true); };
  const openEdit = (p: any) => {
    setForm({
      id: p.id, name: p.name, price: Number(p.price), start_date: p.start_date, end_date: p.end_date, active: p.active,
      items: (p.promotion_items ?? []).map((i: any) => ({ id: i.id, product_id: i.product_id, quantity: Number(i.quantity), unit_type: i.unit_type })),
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Nombre requerido");
    if (form.items.length === 0) return toast.error("Agrega al menos un producto");
    if (form.price <= 0) return toast.error("Precio inválido");

    const payload = {
      name: form.name.trim(), price: form.price,
      start_date: form.start_date || null, end_date: form.end_date || null, active: form.active,
    };
    let promoId = form.id;
    if (promoId) {
      const { error } = await supabase.from("promotions" as any).update(payload).eq("id", promoId);
      if (error) return toast.error(error.message);
      await supabase.from("promotion_items" as any).delete().eq("promotion_id", promoId);
    } else {
      const { data, error } = await supabase.from("promotions" as any).insert(payload).select("id").single();
      if (error) return toast.error(error.message);
      promoId = (data as any).id;
    }
    const itemsPayload = form.items.map((it) => ({
      promotion_id: promoId, product_id: it.product_id, quantity: it.quantity, unit_type: it.unit_type,
    }));
    const { error: e2 } = await supabase.from("promotion_items" as any).insert(itemsPayload);
    if (e2) return toast.error(e2.message);
    toast.success("Promoción guardada");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["promotions"] });
    qc.invalidateQueries({ queryKey: ["pos-promotions"] });
  };

  const del = async (id: string) => {
    if (!confirm("¿Eliminar promoción?")) return;
    const { error } = await supabase.from("promotions" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["promotions"] });
  };

  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { product_id: "", quantity: 1, unit_type: "pieza" }] }));
  const updateItem = (idx: number, patch: Partial<Item>) =>
    setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  const removeItem = (idx: number) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  return (
    <div>
      <PageHeader title="Promociones" subtitle="Paquetes y descuentos por tiempo limitado"
        actions={<Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Nueva</Button>} />

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead><TableHead>Precio</TableHead>
              <TableHead>Productos</TableHead><TableHead>Vigencia</TableHead>
              <TableHead>Estado</TableHead><TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {promos.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium flex items-center gap-2"><Gift className="h-4 w-4 text-warning" />{p.name}</TableCell>
                <TableCell>${Number(p.price).toFixed(2)}</TableCell>
                <TableCell className="text-xs">
                  {(p.promotion_items ?? []).map((i: any) => `${Number(i.quantity)} × ${i.products?.name ?? "—"}`).join(" + ")}
                </TableCell>
                <TableCell className="text-xs">
                  {p.start_date ? format(new Date(p.start_date), "dd/MM/yy") : "—"} → {p.end_date ? format(new Date(p.end_date), "dd/MM/yy") : "—"}
                </TableCell>
                <TableCell>
                  {p.active ? <Badge className="bg-success text-success-foreground">Activa</Badge> : <Badge variant="secondary">Inactiva</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => del(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {promos.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No hay promociones</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{form.id ? "Editar" : "Nueva"} promoción</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nombre del paquete</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Precio del paquete</Label><Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Inicio</Label><Input type="date" value={form.start_date ?? ""} onChange={(e) => setForm({ ...form, start_date: e.target.value || null })} /></div>
              <div><Label>Fin</Label><Input type="date" value={form.end_date ?? ""} onChange={(e) => setForm({ ...form, end_date: e.target.value || null })} /></div>
              <div className="flex items-end gap-2"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /><Label>Activa</Label></div>
            </div>

            <div className="border-t pt-3">
              <div className="mb-2 flex items-center justify-between">
                <Label>Productos incluidos</Label>
                <Button size="sm" variant="outline" onClick={addItem}><Plus className="mr-1 h-3 w-3" />Agregar</Button>
              </div>
              <div className="space-y-2">
                {form.items.map((it, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Select value={it.product_id} onValueChange={(v) => {
                      const p = (products as any[]).find((x) => x.id === v);
                      updateItem(idx, { product_id: v, unit_type: p?.unit_type ?? "pieza" });
                    }}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Producto" /></SelectTrigger>
                      <SelectContent>
                        {(products as any[]).map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.unit_type})</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input type="number" step="0.01" min={0.01} className="w-28" value={it.quantity}
                      onChange={(e) => updateItem(idx, { quantity: parseFloat(e.target.value) || 0 })} />
                    <span className="text-xs text-muted-foreground w-12">{it.unit_type === "litro" ? "L" : "pz"}</span>
                    <Button size="icon" variant="ghost" onClick={() => removeItem(idx)}><X className="h-4 w-4" /></Button>
                  </div>
                ))}
                {form.items.length === 0 && <p className="text-xs text-muted-foreground">Sin productos. Agrega al menos uno.</p>}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
