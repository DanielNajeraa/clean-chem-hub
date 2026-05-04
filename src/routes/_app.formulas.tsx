import { createFileRoute } from "@tanstack/react-router";
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
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/formulas")({ component: FormulasPage });

function FormulasPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

  const { data: formulas = [] } = useQuery({
    queryKey: ["formulas-full"],
    queryFn: async () => (await supabase.from("formulas").select("*, formula_items(*, raw_materials(name,unit,cost_per_unit))").order("name")).data ?? [],
  });
  const { data: rms = [] } = useQuery({
    queryKey: ["rms"], queryFn: async () => (await supabase.from("raw_materials").select("*").order("name")).data ?? [],
  });

  const startNew = () => { setEditing({ name: "", items: [] }); setOpen(true); };
  const startEdit = (f: any) => {
    setEditing({
      id: f.id, name: f.name,
      items: f.formula_items.map((i: any) => ({ id: i.id, raw_material_id: i.raw_material_id, quantity: i.quantity, unit: i.unit })),
    });
    setOpen(true);
  };

  const save = async () => {
    if (!editing.name.trim()) return toast.error("Nombre requerido");
    let formulaId = editing.id;
    if (formulaId) {
      const { error } = await supabase.from("formulas").update({ name: editing.name }).eq("id", formulaId);
      if (error) return toast.error(error.message);
      await supabase.from("formula_items").delete().eq("formula_id", formulaId);
    } else {
      const { data, error } = await supabase.from("formulas").insert({ name: editing.name }).select().single();
      if (error) return toast.error(error.message);
      formulaId = data.id;
    }
    if (editing.items.length) {
      const ins = editing.items.map((i: any) => ({ formula_id: formulaId, raw_material_id: i.raw_material_id, quantity: Number(i.quantity), unit: i.unit }));
      const { error } = await supabase.from("formula_items").insert(ins);
      if (error) return toast.error(error.message);
    }
    toast.success("Guardado");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["formulas-full"] });
    qc.invalidateQueries({ queryKey: ["formulas-list"] });
  };

  const del = async (id: string) => {
    if (!confirm("¿Eliminar fórmula?")) return;
    const { error } = await supabase.from("formulas").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["formulas-full"] });
  };

  const cost = (items: any[]) => items.reduce((s, i) => s + Number(i.quantity) * Number(i.raw_materials?.cost_per_unit ?? 0), 0);

  return (
    <div>
      <PageHeader title="Fórmulas" subtitle="Recetas de fabricación con cálculo de costo automático"
        actions={<Button onClick={startNew} className="bg-warning text-warning-foreground hover:bg-warning/90"><Plus className="mr-2 h-4 w-4" />Nueva</Button>} />

      <div className="grid gap-4 md:grid-cols-2">
        {formulas.map((f: any) => (
          <div key={f.id} className="rounded-md border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{f.name}</h3>
                <p className="text-xs text-muted-foreground">Costo estimado: <span className="font-semibold text-success">${cost(f.formula_items).toFixed(2)}</span></p>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => startEdit(f)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => del(f.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
            <ul className="space-y-1 text-sm">
              {f.formula_items.map((i: any) => (
                <li key={i.id} className="flex justify-between border-b py-1 last:border-0">
                  <span>{i.raw_materials?.name}</span>
                  <span className="text-muted-foreground">{Number(i.quantity)} {i.unit}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Nueva"} fórmula</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div><Label>Nombre</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label>Ingredientes</Label>
                  <Button size="sm" variant="outline" onClick={() => setEditing({ ...editing, items: [...editing.items, { raw_material_id: "", quantity: 0, unit: "L" }] })}>
                    <Plus className="mr-1 h-3 w-3" /> Añadir
                  </Button>
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>Materia prima</TableHead><TableHead>Cantidad</TableHead><TableHead>Unidad</TableHead><TableHead></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {editing.items.map((it: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Select value={it.raw_material_id} onValueChange={(v) => {
                            const rm = rms.find((r: any) => r.id === v);
                            const next = [...editing.items];
                            next[idx] = { ...it, raw_material_id: v, unit: rm?.unit ?? it.unit };
                            setEditing({ ...editing, items: next });
                          }}>
                            <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                            <SelectContent>{rms.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Input type="number" step="0.01" value={it.quantity} onChange={(e) => {
                          const next = [...editing.items]; next[idx] = { ...it, quantity: e.target.value }; setEditing({ ...editing, items: next });
                        }} /></TableCell>
                        <TableCell><Input value={it.unit} onChange={(e) => {
                          const next = [...editing.items]; next[idx] = { ...it, unit: e.target.value }; setEditing({ ...editing, items: next });
                        }} className="w-20" /></TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => setEditing({ ...editing, items: editing.items.filter((_: any, i: number) => i !== idx) })}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={save}>Guardar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
