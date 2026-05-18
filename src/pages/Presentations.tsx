import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

const DEFAULTS = [
  { label: "20L", liters: 20, is_bulk: false },
  { label: "5L", liters: 5, is_bulk: false },
  { label: "1L", liters: 1, is_bulk: false },
  { label: "Granel", liters: 1, is_bulk: true },
];

function PresentationsPage() {
  const qc = useQueryClient();
  const [selProduct, setSelProduct] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: products = [] } = useQuery({
    queryKey: ["products-list"],
    queryFn: async () => (await supabase.from("products").select("id,name").order("name")).data ?? [],
  });
  const { data: presentations = [] } = useQuery({
    enabled: !!selProduct,
    queryKey: ["presentations", selProduct],
    queryFn: async () => (await supabase.from("product_presentations").select("*").eq("product_id", selProduct).order("liters", { ascending: false })).data ?? [],
  });

  const startNew = () => { setEditing({ product_id: selProduct, label: "", liters: 1, price: 0, is_bulk: false, active: true }); setOpen(true); };
  const startEdit = (p: any) => { setEditing({ ...p }); setOpen(true); };
  const addDefault = async (d: typeof DEFAULTS[number]) => {
    const { error } = await supabase.from("product_presentations").insert({ product_id: selProduct, label: d.label, liters: d.liters, price: 0, is_bulk: d.is_bulk });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["presentations"] });
  };

  const save = async () => {
    const payload = { ...editing, liters: Number(editing.liters), price: Number(editing.price) };
    if (payload.id) {
      const { id, ...rest } = payload;
      const { error } = await supabase.from("product_presentations").update(rest).eq("id", id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("product_presentations").insert(payload);
      if (error) return toast.error(error.message);
    }
    toast.success("Guardado"); setOpen(false);
    qc.invalidateQueries({ queryKey: ["presentations"] });
  };

  const del = async (id: string) => {
    if (!confirm("¿Eliminar presentación?")) return;
    const { error } = await supabase.from("product_presentations").delete().eq("id", id);
    if (error) return toast.error("No se puede eliminar: " + error.message);
    qc.invalidateQueries({ queryKey: ["presentations"] });
  };

  return (
    <div>
      <PageHeader title="Presentaciones y precios" subtitle="Define cómo se vende cada producto (20L, 5L, 1L, granel)" />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[260px]">
          <Label>Producto</Label>
          <Select value={selProduct} onValueChange={setSelProduct}>
            <SelectTrigger><SelectValue placeholder="Selecciona un producto" /></SelectTrigger>
            <SelectContent>{products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {selProduct && (
          <Button onClick={startNew} className="bg-warning text-warning-foreground hover:bg-warning/90"><Plus className="mr-2 h-4 w-4" />Nueva presentación</Button>
        )}
      </div>

      {selProduct && presentations.length === 0 && (
        <div className="mb-4 rounded-md border bg-muted/30 p-4">
          <p className="mb-2 text-sm font-medium">Agregar presentaciones típicas:</p>
          <div className="flex flex-wrap gap-2">
            {DEFAULTS.map((d) => <Button key={d.label} size="sm" variant="outline" onClick={() => addDefault(d)}><Plus className="mr-1 h-3 w-3" />{d.label}</Button>)}
          </div>
        </div>
      )}

      {selProduct && (
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Etiqueta</TableHead><TableHead>Litros</TableHead><TableHead>Precio</TableHead>
              <TableHead>Tipo</TableHead><TableHead>Estado</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {presentations.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.label}</TableCell>
                  <TableCell>{Number(p.liters)} L</TableCell>
                  <TableCell>${Number(p.price).toFixed(2)}{p.is_bulk && " /L"}</TableCell>
                  <TableCell>{p.is_bulk ? <Badge className="bg-warning/20 text-warning-foreground">Granel</Badge> : <Badge variant="outline">Envase</Badge>}</TableCell>
                  <TableCell>{p.active ? <Badge className="bg-success text-success-foreground">Activa</Badge> : <Badge variant="outline">Inactiva</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => startEdit(p)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => del(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Nueva"} presentación</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div><Label>Etiqueta</Label><Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="20L, 5L, Granel..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Litros</Label><Input type="number" step="0.01" value={editing.liters} onChange={(e) => setEditing({ ...editing, liters: e.target.value })} /></div>
                <div><Label>Precio {editing.is_bulk ? "por litro" : "por unidad"}</Label><Input type="number" step="0.01" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} /></div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div><Label>¿Es granel?</Label><p className="text-xs text-muted-foreground">El cliente trae su envase, precio por litro.</p></div>
                <Switch checked={editing.is_bulk} onCheckedChange={(v) => setEditing({ ...editing, is_bulk: v })} />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label>Activa</Label>
                <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={save}>Guardar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default PresentationsPage;
