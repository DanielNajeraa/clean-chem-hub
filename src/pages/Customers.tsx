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
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

function CustomersPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("all");

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"], queryFn: async () => (await supabase.from("customers").select("*").order("name")).data ?? [],
  });

  const tags = Array.from(new Set(customers.map((c: any) => c.city).filter(Boolean))) as string[];
  const filtered = customers.filter((c: any) =>
    c.name.toLowerCase().includes(q.toLowerCase()) &&
    (tagFilter === "all" || c.city === tagFilter)
  );

  const save = async () => {
    if (editing.id) {
      const { id, ...rest } = editing;
      const { error } = await supabase.from("customers").update(rest).eq("id", id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("customers").insert(editing);
      if (error) return toast.error(error.message);
    }
    toast.success("Guardado"); setOpen(false);
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  return (
    <div>
      <PageHeader title="Clientes" subtitle="Directorio y tipos"
        actions={<Button onClick={() => { setEditing({ name: "", phone: "", email: "", type: "minorista", city: "", address: "" }); setOpen(true); }} className="bg-warning text-warning-foreground hover:bg-warning/90"><Plus className="mr-2 h-4 w-4" />Nuevo</Button>} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Filtrar por etiqueta" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las etiquetas</SelectItem>
            {tags.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Tipo</TableHead><TableHead>Etiqueta</TableHead><TableHead>Dirección</TableHead><TableHead>Teléfono</TableHead><TableHead>Email</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.map((c: any) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell><Badge variant={c.type === "mayorista" ? "default" : "secondary"}>{c.type}</Badge></TableCell>
                <TableCell>{c.city ? <Badge variant="outline" className="bg-warning/10">📍 {c.city}</Badge> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{c.address || "—"}</TableCell>
                <TableCell>{c.phone}</TableCell>
                <TableCell>{c.email}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={async () => {
                    if (!confirm("¿Eliminar?")) return;
                    const { error } = await supabase.from("customers").delete().eq("id", c.id);
                    if (error) return toast.error(error.message);
                    qc.invalidateQueries({ queryKey: ["customers"] });
                  }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Nuevo"} cliente</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div><Label>Nombre</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Teléfono</Label><Input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></div>
                <div><Label>Email</Label><Input value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></div>
              </div>
              <div><Label>Tipo</Label>
                <Select value={editing.type} onValueChange={(v) => setEditing({ ...editing, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="minorista">Minorista</SelectItem><SelectItem value="mayorista">Mayorista</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Etiqueta / Localidad</Label>
                  <Select value={editing.city ?? ""} onValueChange={(v) => setEditing({ ...editing, city: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecciona etiqueta" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Los Mochis">Los Mochis</SelectItem>
                      <SelectItem value="Guasave">Guasave</SelectItem>
                      <SelectItem value="El Fuerte">El Fuerte</SelectItem>
                      <SelectItem value="Ahome">Ahome</SelectItem>
                      <SelectItem value="Choix">Choix</SelectItem>
                      <SelectItem value="Sinaloa de Leyva">Sinaloa de Leyva</SelectItem>
                      <SelectItem value="Culiacán">Culiacán</SelectItem>
                      <SelectItem value="Otra">Otra</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Dirección</Label><Input value={editing.address ?? ""} onChange={(e) => setEditing({ ...editing, address: e.target.value })} placeholder="Calle, número, colonia" /></div>
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={save}>Guardar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CustomersPage;
