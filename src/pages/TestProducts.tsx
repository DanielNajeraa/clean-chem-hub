import { useMemo, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Upload, Image as ImageIcon, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useProductImageUrls } from "@/hooks/use-product-image-urls";

const BUCKET = "test-product-images";

function TestProductsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["test_products"],
    queryFn: async () => {
      const { data } = await supabase.from("test_products").select("*").order("name");
      return data ?? [];
    },
  });
  const { urls: imgUrls, refreshImage } = useProductImageUrls(products);

  const [search, setSearch] = useState("");
  const [typeF, setTypeF] = useState("all");
  const [categoryF, setCategoryF] = useState("all");
  const [stockF, setStockF] = useState("all"); // all|in|out

  const categories = useMemo(
    () => [...new Set(products.map((p: any) => (p.category ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    [products],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p: any) => {
      if (typeF !== "all" && p.unit_type !== typeF) return false;
      if (categoryF !== "all" && (p.category ?? "").trim() !== categoryF) return false;
      if (stockF === "in" && !(Number(p.stock) > 0)) return false;
      if (stockF === "out" && Number(p.stock) > 0) return false;
      return !q || p.name.toLowerCase().includes(q) || (p.category ?? "").toLowerCase().includes(q);
    });
  }, [products, search, typeF, categoryF, stockF]);

  const hasFilters = search !== "" || typeF !== "all" || categoryF !== "all" || stockF !== "all";
  const clearFilters = () => { setSearch(""); setTypeF("all"); setCategoryF("all"); setStockF("all"); };

  const startNew = () => {
    setEditing({
      name: "", category: "", unit_type: "litro", stock: 0,
      price_granel: 0, price_1l: 0, price_5l: 0, price_20l: 0, price_pieza: 0,
      image_url: null, active: true,
    });
    setOpen(true);
  };
  const startEdit = (p: any) => { setEditing({ ...p }); setOpen(true); };

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type, upsert: false,
      });
      if (error) throw error;
      setEditing((e: any) => ({ ...e, image_url: path }));
      toast.success("Imagen cargada");
    } catch (e: any) {
      toast.error(e.message ?? "Error al subir imagen");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const payload = { ...editing };
    ["stock","price_granel","price_1l","price_5l","price_20l","price_pieza"].forEach((k) => {
      payload[k] = Number(payload[k] || 0);
    });
    if (!payload.name) return toast.error("Falta el nombre");
    if (payload.id) {
      const { error } = await supabase.from("test_products").update(payload).eq("id", payload.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("test_products").insert(payload);
      if (error) return toast.error(error.message);
    }
    toast.success("Guardado");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["test_products"] });
    qc.invalidateQueries({ queryKey: ["test_products_pos"] });
  };

  const del = async (p: any) => {
    if (!confirm("¿Eliminar producto?")) return;
    if (p.image_url) await supabase.storage.from(BUCKET).remove([p.image_url]);
    const { error } = await supabase.from("test_products").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Eliminado");
    qc.invalidateQueries({ queryKey: ["test_products"] });
  };

  return (
    <div>
      <PageHeader
        title="Productos (prueba)"
        subtitle="Alta manual con presentaciones y precios, sin producción"
        actions={<Button onClick={startNew}><Plus className="mr-2 h-4 w-4" />Nuevo</Button>}
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative w-full sm:w-72">
          <Label className="text-xs">Buscar</Label>
          <Search className="absolute left-2 top-7.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Nombre o categoría" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div><Label className="text-xs">Tipo</Label>
          <Select value={typeF} onValueChange={setTypeF}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="litro">Líquidos</SelectItem>
              <SelectItem value="pieza">Piezas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">Categoría</Label>
          <Select value={categoryF} onValueChange={setCategoryF}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">Stock</Label>
          <Select value={stockF} onValueChange={setStockF}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="in">Con stock</SelectItem>
              <SelectItem value="out">Sin stock</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters}><X className="mr-1 h-4 w-4" />Limpiar</Button>
        )}
        <div className="ml-auto self-center text-sm text-muted-foreground">
          {filtered.length} de {products.length} productos
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Imagen</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead>Precios</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell>
                  {imgUrls[p.id]
                    ? <img src={imgUrls[p.id]} alt={p.name} className="h-12 w-12 rounded border bg-white object-contain p-0.5" onError={() => refreshImage(p.id)} />
                    : <div className="flex h-12 w-12 items-center justify-center rounded bg-muted"><ImageIcon className="h-5 w-5 text-muted-foreground" /></div>}
                </TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.category || "—"}</TableCell>
                <TableCell><Badge variant="outline">{p.unit_type}</Badge></TableCell>
                <TableCell>{Number(p.stock)} {p.unit_type === "litro" ? "L" : "pz"}</TableCell>
                <TableCell className="text-xs">
                  {p.unit_type === "litro" ? (
                    <div className="space-y-0.5">
                      <div>Granel: ${Number(p.price_granel).toFixed(2)}</div>
                      <div>1L: ${Number(p.price_1l).toFixed(2)} · 5L: ${Number(p.price_5l).toFixed(2)} · 20L: ${Number(p.price_20l).toFixed(2)}</div>
                    </div>
                  ) : (
                    <div>Pieza: ${Number(p.price_pieza).toFixed(2)}</div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => startEdit(p)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => del(p)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {products.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">Sin productos. Da de alta el primero.</TableCell></TableRow>
            )}
            {products.length > 0 && filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">Ningún producto coincide con los filtros.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Nuevo"} producto (prueba)</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div><Label>Nombre</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Categoría</Label><Input placeholder="Ej. Limpiadores" value={editing.category ?? ""} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></div>
                <div><Label>Tipo</Label>
                  <Select value={editing.unit_type} onValueChange={(v) => setEditing({ ...editing, unit_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="litro">Líquido (litros)</SelectItem>
                      <SelectItem value="pieza">Pieza</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Imagen</Label>
                <div className="flex items-center gap-3">
                  {editing.image_url && (
                    <PreviewImage path={editing.image_url} />
                  )}
                  <input ref={fileRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                  <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <Upload className="mr-2 h-4 w-4" />{uploading ? "Subiendo…" : "Subir imagen"}
                  </Button>
                  {editing.image_url && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing({ ...editing, image_url: null })}>Quitar</Button>
                  )}
                </div>
              </div>

              <div><Label>Stock inicial</Label><Input type="number" step="0.01" value={editing.stock} onChange={(e) => setEditing({ ...editing, stock: e.target.value })} /></div>

              {editing.unit_type === "litro" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Precio Granel (por L)</Label><Input type="number" step="0.01" value={editing.price_granel} onChange={(e) => setEditing({ ...editing, price_granel: e.target.value })} /></div>
                  <div><Label>Precio 1 L</Label><Input type="number" step="0.01" value={editing.price_1l} onChange={(e) => setEditing({ ...editing, price_1l: e.target.value })} /></div>
                  <div><Label>Precio 5 L</Label><Input type="number" step="0.01" value={editing.price_5l} onChange={(e) => setEditing({ ...editing, price_5l: e.target.value })} /></div>
                  <div><Label>Precio 20 L</Label><Input type="number" step="0.01" value={editing.price_20l} onChange={(e) => setEditing({ ...editing, price_20l: e.target.value })} /></div>
                </div>
              ) : (
                <div><Label>Precio por pieza</Label><Input type="number" step="0.01" value={editing.price_pieza} onChange={(e) => setEditing({ ...editing, price_pieza: e.target.value })} /></div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PreviewImage({ path }: { path: string }) {
  const { data } = useQuery({
    queryKey: ["test_img", path],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 86400);
      if (error) throw error;
      return data.signedUrl;
    },
    staleTime: 0,
  });
  if (!data) return null;
  return <img src={data} alt="preview" className="h-16 w-16 rounded border bg-white object-contain p-0.5" />;
}

export default TestProductsPage;
