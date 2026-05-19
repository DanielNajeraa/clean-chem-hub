import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Beaker, Droplet, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

function ProductsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [viewFormula, setViewFormula] = useState<string | null>(null);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*, categories(name), formulas(name)").order("name")).data ?? [],
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"], queryFn: async () => (await supabase.from("categories").select("*")).data ?? [],
  });
  const { data: formulas = [] } = useQuery({
    queryKey: ["formulas-list"], enabled: isAdmin,
    queryFn: async () => (await supabase.from("formulas").select("*")).data ?? [],
  });

  const startNew = () => { setEditing({ name: "", category_id: null, presentation: "", unit_type: "pieza", is_bulk: false, price: 0, stock: 0, formula_id: null }); setOpen(true); };
  const startEdit = (p: any) => { setEditing({ ...p }); setOpen(true); };

  const save = async () => {
    const payload = { ...editing };
    delete payload.categories; delete payload.formulas;
    payload.price = Number(payload.price); payload.stock = Number(payload.stock);
    if (payload.id) {
      const { error } = await supabase.from("products").update(payload).eq("id", payload.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("products").insert(payload);
      if (error) return toast.error(error.message);
    }
    toast.success("Guardado");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const del = async (id: string) => {
    if (!confirm("¿Eliminar producto?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Eliminado");
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  return (
    <div>
      <PageHeader title="Productos terminados" subtitle="Catálogo, precios e inventario"
        actions={isAdmin && <Button onClick={startNew} className="bg-warning text-warning-foreground hover:bg-warning/90"><Plus className="mr-2 h-4 w-4" />Nuevo</Button>} />

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead><TableHead>Categoría</TableHead><TableHead>Tipo</TableHead>
              <TableHead>Precio base</TableHead><TableHead>Stock</TableHead>{isAdmin && <TableHead>Fórmula</TableHead>}<TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p: any) => {
              const isLiquid = p.unit_type === "litro";
              return (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.categories?.name ?? "—"}</TableCell>
                <TableCell>
                  {isLiquid
                    ? <Badge variant="outline" className="bg-primary/10"><Droplet className="mr-1 h-3 w-3" />Litro</Badge>
                    : <Badge variant="outline"><Package className="mr-1 h-3 w-3" />Pieza</Badge>}
                </TableCell>
                <TableCell>${Number(p.price).toFixed(2)}</TableCell>
                <TableCell><span className={Number(p.stock) <= 5 ? "text-destructive font-medium" : ""}>{Number(p.stock)} {isLiquid ? "L" : "pz"}</span></TableCell>
                {isAdmin && <TableCell>
                  {p.formulas?.name ? <Button size="sm" variant="outline" onClick={() => setViewFormula(p.formula_id)}><Beaker className="mr-1 h-3 w-3" />{p.formulas.name}</Button> : "—"}
                </TableCell>}
                <TableCell className="text-right">
                  {isAdmin && <>
                    <Button size="icon" variant="ghost" onClick={() => startEdit(p)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => del(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </>}
                </TableCell>
              </TableRow>
            );})}
          </TableBody>
        </Table>
      </div>

      {isAdmin && <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Nuevo"} producto</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div><Label>Nombre</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Categoría</Label>
                  <Select value={editing.category_id ?? ""} onValueChange={(v) => setEditing({ ...editing, category_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                    <SelectContent>{categories.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Tipo de unidad</Label>
                  <Select value={editing.unit_type} onValueChange={(v) => setEditing({ ...editing, unit_type: v, is_bulk: v === "litro" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="litro">Litro (líquido, con garrafones)</SelectItem>
                      <SelectItem value="pieza">Pieza (stock simple)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                {editing.unit_type === "litro"
                  ? "🛢 Líquido: el stock se mide en litros y al producir se generan garrafones. Las presentaciones (1L, 5L, 20L, granel) y sus precios se definen en Presentaciones."
                  : "📦 Pieza: stock por unidades, se vende como cualquier producto convencional (ej. trapeador, escoba)."}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Precio base</Label><Input type="number" step="0.01" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} /></div>
                <div><Label>Stock inicial</Label><Input type="number" step="0.01" value={editing.stock} onChange={(e) => setEditing({ ...editing, stock: e.target.value })} /></div>
              </div>
              {editing.unit_type === "litro" && (
                <div><Label>Fórmula</Label>
                  <Select value={editing.formula_id ?? ""} onValueChange={(v) => setEditing({ ...editing, formula_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Sin fórmula" /></SelectTrigger>
                    <SelectContent>{formulas.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div><Label>URL imagen (opcional)</Label><Input value={editing.image_url ?? ""} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={save}>Guardar</Button></DialogFooter>
        </DialogContent>
      </Dialog>}

      <FormulaViewer formulaId={viewFormula} onClose={() => setViewFormula(null)} />
    </div>
  );
}

function FormulaViewer({ formulaId, onClose }: { formulaId: string | null; onClose: () => void }) {
  const { data } = useQuery({
    enabled: !!formulaId,
    queryKey: ["formula-view", formulaId],
    queryFn: async () => {
      const [f, items] = await Promise.all([
        supabase.from("formulas").select("*").eq("id", formulaId!).single(),
        supabase.from("formula_items").select("*, raw_materials(name,cost_per_unit,unit)").eq("formula_id", formulaId!),
      ]);
      const cost = (items.data ?? []).reduce((s, i: any) => s + Number(i.quantity) * Number(i.raw_materials?.cost_per_unit ?? 0), 0);
      return { formula: f.data, items: items.data ?? [], cost };
    },
  });
  return (
    <Dialog open={!!formulaId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Fórmula: {data?.formula?.name}</DialogTitle></DialogHeader>
        <Table>
          <TableHeader><TableRow><TableHead>Materia prima</TableHead><TableHead>Cantidad</TableHead><TableHead>Costo</TableHead></TableRow></TableHeader>
          <TableBody>
            {data?.items.map((i: any) => (
              <TableRow key={i.id}>
                <TableCell>{i.raw_materials?.name}</TableCell>
                <TableCell>{Number(i.quantity)} {i.unit}</TableCell>
                <TableCell>${(Number(i.quantity) * Number(i.raw_materials?.cost_per_unit ?? 0)).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex justify-end border-t pt-3 font-semibold">Costo total estimado: ${(data?.cost ?? 0).toFixed(2)}</div>
      </DialogContent>
    </Dialog>
  );
}

export default ProductsPage;
