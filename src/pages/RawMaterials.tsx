import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, Factory, Tag } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

function RawMaterialsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [movOpen, setMovOpen] = useState(false);
  const [mov, setMov] = useState<any>({ raw_material_id: "", movement_type: "in", quantity: 0, reason: "" });

  const { data: rms = [] } = useQuery({
    queryKey: ["rms-full"], queryFn: async () => (await supabase.from("raw_materials").select("*").order("name")).data ?? [],
  });
  const { data: formulas = [] } = useQuery({
    queryKey: ["formulas-list-rm"], queryFn: async () => (await supabase.from("formulas").select("id,name").order("name")).data ?? [],
  });
  const { data: movs = [] } = useQuery({
    queryKey: ["movs"], queryFn: async () => (await supabase.from("inventory_movements").select("*, raw_materials(name)").order("created_at", { ascending: false }).limit(50)).data ?? [],
  });

  const save = async () => {
    const payload: any = {
      name: editing.name,
      unit: editing.unit,
      stock: Number(editing.stock),
      cost_per_unit: Number(editing.cost_per_unit),
      reorder_point: Number(editing.reorder_point),
      is_producible: !!editing.is_producible,
      formula_id: editing.is_producible ? (editing.formula_id || null) : null,
      is_sellable: !!editing.is_sellable,
      sale_price: editing.is_sellable ? Number(editing.sale_price || 0) : 0,
    };
    if (editing.id) {
      const { error } = await supabase.from("raw_materials").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("raw_materials").insert(payload);
      if (error) return toast.error(error.message);
    }
    toast.success("Guardado"); setOpen(false);
    qc.invalidateQueries({ queryKey: ["rms-full"] });
  };

  const saveMov = async () => {
    if (!mov.raw_material_id || !mov.quantity) return toast.error("Datos incompletos");
    const q = Number(mov.quantity);
    const rm: any = rms.find((r: any) => r.id === mov.raw_material_id);
    if (!rm) return toast.error("Material no encontrado");
    const newStock = mov.movement_type === "in" ? Number(rm.stock) + q : Number(rm.stock) - q;
    if (newStock < 0) return toast.error("Stock no puede ser negativo");
    const { error: e1 } = await supabase.from("raw_materials").update({ stock: newStock }).eq("id", mov.raw_material_id);
    if (e1) return toast.error(e1.message);
    const { error: e2 } = await supabase.from("inventory_movements").insert({ ...mov, quantity: q, user_id: user!.id });
    if (e2) return toast.error(e2.message);
    toast.success("Movimiento registrado");
    setMovOpen(false); setMov({ raw_material_id: "", movement_type: "in", quantity: 0, reason: "" });
    qc.invalidateQueries({ queryKey: ["rms-full"] });
    qc.invalidateQueries({ queryKey: ["movs"] });
  };

  return (
    <div>
      <PageHeader title="Materia prima" subtitle="Inventario, costos, fabricación interna y venta"
        actions={<>
          <Button variant="outline" onClick={() => setMovOpen(true)}><ArrowDownToLine className="mr-2 h-4 w-4" />Movimiento</Button>
          <Button onClick={() => { setEditing({ name: "", unit: "L", stock: 0, cost_per_unit: 0, reorder_point: 0, is_producible: false, formula_id: "", is_sellable: false, sale_price: 0 }); setOpen(true); }}
            className="bg-warning text-warning-foreground hover:bg-warning/90"><Plus className="mr-2 h-4 w-4" />Nueva</Button>
        </>} />

      <Tabs defaultValue="list">
        <TabsList><TabsTrigger value="list">Inventario</TabsTrigger><TabsTrigger value="movs">Movimientos</TabsTrigger></TabsList>
        <TabsContent value="list">
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Nombre</TableHead><TableHead>Unidad</TableHead><TableHead>Stock</TableHead><TableHead>Costo/u</TableHead><TableHead>Mín</TableHead><TableHead>Etiquetas</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rms.map((r: any) => {
                  const low = Number(r.stock) <= Number(r.reorder_point);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name} {low && <Badge variant="destructive" className="ml-1"><AlertTriangle className="mr-1 h-3 w-3" />Bajo</Badge>}</TableCell>
                      <TableCell>{r.unit}</TableCell>
                      <TableCell>{Number(r.stock)}</TableCell>
                      <TableCell>${Number(r.cost_per_unit).toFixed(2)}</TableCell>
                      <TableCell>{Number(r.reorder_point)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.is_producible && <Badge variant="outline" className="bg-primary/10"><Factory className="mr-1 h-3 w-3" />Se fabrica</Badge>}
                          {r.is_sellable && <Badge variant="outline" className="bg-success/10"><Tag className="mr-1 h-3 w-3" />Se vende ${Number(r.sale_price).toFixed(2)}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={async () => {
                          if (!confirm("¿Eliminar?")) return;
                          const { error } = await supabase.from("raw_materials").delete().eq("id", r.id);
                          if (error) return toast.error(error.message);
                          qc.invalidateQueries({ queryKey: ["rms-full"] });
                        }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
        <TabsContent value="movs">
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Material</TableHead><TableHead>Tipo</TableHead><TableHead>Cantidad</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader>
              <TableBody>
                {movs.map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell>{new Date(m.created_at).toLocaleString()}</TableCell>
                    <TableCell>{m.raw_materials?.name}</TableCell>
                    <TableCell>{m.movement_type === "in" ? <Badge className="bg-success text-success-foreground"><ArrowDownToLine className="mr-1 h-3 w-3" />Entrada</Badge> : <Badge variant="outline"><ArrowUpFromLine className="mr-1 h-3 w-3" />Salida</Badge>}</TableCell>
                    <TableCell>{Number(m.quantity)}</TableCell>
                    <TableCell>{m.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Nueva"} materia prima</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div><Label>Nombre</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Unidad</Label>
                  <Select value={editing.unit} onValueChange={(v) => setEditing({ ...editing, unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="L">L</SelectItem><SelectItem value="ml">ml</SelectItem><SelectItem value="kg">kg</SelectItem><SelectItem value="g">g</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>Stock</Label><Input type="number" step="0.01" value={editing.stock} onChange={(e) => setEditing({ ...editing, stock: e.target.value })} /></div>
                <div><Label>Costo por unidad</Label><Input type="number" step="0.01" value={editing.cost_per_unit} onChange={(e) => setEditing({ ...editing, cost_per_unit: e.target.value })} /></div>
                <div><Label>Punto de reorden</Label><Input type="number" step="0.01" value={editing.reorder_point} onChange={(e) => setEditing({ ...editing, reorder_point: e.target.value })} /></div>
              </div>

              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Se fabrica internamente</Label>
                    <p className="text-xs text-muted-foreground">Permite producir esta materia prima desde Producción</p>
                  </div>
                  <Switch checked={!!editing.is_producible} onCheckedChange={(v) => setEditing({ ...editing, is_producible: v })} />
                </div>
                {editing.is_producible && (
                  <div>
                    <Label>Fórmula</Label>
                    <Select value={editing.formula_id ?? ""} onValueChange={(v) => setEditing({ ...editing, formula_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecciona fórmula" /></SelectTrigger>
                      <SelectContent>{formulas.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Se vende a otros fabricantes</Label>
                    <p className="text-xs text-muted-foreground">Aparecerá en el POS para venderla por unidad de medida</p>
                  </div>
                  <Switch checked={!!editing.is_sellable} onCheckedChange={(v) => setEditing({ ...editing, is_sellable: v })} />
                </div>
                {editing.is_sellable && (
                  <div>
                    <Label>Precio de venta por {editing.unit}</Label>
                    <Input type="number" step="0.01" value={editing.sale_price ?? 0} onChange={(e) => setEditing({ ...editing, sale_price: e.target.value })} />
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={save}>Guardar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={movOpen} onOpenChange={setMovOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar movimiento</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Materia prima</Label>
              <Select value={mov.raw_material_id} onValueChange={(v) => setMov({ ...mov, raw_material_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                <SelectContent>{rms.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tipo</Label>
                <Select value={mov.movement_type} onValueChange={(v) => setMov({ ...mov, movement_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="in">Entrada (compra)</SelectItem><SelectItem value="out">Salida</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Cantidad</Label><Input type="number" step="0.01" value={mov.quantity} onChange={(e) => setMov({ ...mov, quantity: e.target.value })} /></div>
            </div>
            <div><Label>Motivo</Label><Input value={mov.reason} onChange={(e) => setMov({ ...mov, reason: e.target.value })} placeholder="Compra, ajuste, merma..." /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setMovOpen(false)}>Cancelar</Button><Button onClick={saveMov}>Registrar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default RawMaterialsPage;
