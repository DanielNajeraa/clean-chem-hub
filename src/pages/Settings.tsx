import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

function SettingsPage() {
  const qc = useQueryClient();
  const { data: s } = useQuery({ queryKey: ["settings"], queryFn: async () => (await supabase.from("settings").select("*").single()).data });
  const { data: cats = [] } = useQuery({ queryKey: ["categories"], queryFn: async () => (await supabase.from("categories").select("*").order("name")).data ?? [] });
  const [form, setForm] = useState<any>(null);
  const [newCat, setNewCat] = useState("");

  useEffect(() => { if (s) setForm(s); }, [s]);

  const save = async () => {
    const { error } = await supabase.from("settings").update({
      business_name: form.business_name, address: form.address, phone: form.phone,
      discount_threshold: Number(form.discount_threshold), discount_percent: Number(form.discount_percent),
    }).eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success("Guardado");
    qc.invalidateQueries({ queryKey: ["settings"] });
  };

  const addCat = async () => {
    if (!newCat.trim()) return;
    const { error } = await supabase.from("categories").insert({ name: newCat.trim() });
    if (error) return toast.error(error.message);
    setNewCat(""); qc.invalidateQueries({ queryKey: ["categories"] });
  };

  return (
    <div>
      <PageHeader title="Configuración" subtitle="Datos del negocio, descuentos y categorías" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardContent className="space-y-4 p-6">
          <h3 className="font-semibold">Datos del negocio</h3>
          {form && <>
            <div><Label>Nombre</Label><Input value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} /></div>
            <div><Label>Dirección</Label><Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><Label>Teléfono</Label><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <div><Label>Umbral de unidades</Label><Input type="number" value={form.discount_threshold} onChange={(e) => setForm({ ...form, discount_threshold: e.target.value })} /></div>
              <div><Label>% Descuento</Label><Input type="number" step="0.1" value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} /></div>
            </div>
            <Button onClick={save} className="w-full">Guardar</Button>
          </>}
        </CardContent></Card>

        <Card><CardContent className="space-y-3 p-6">
          <h3 className="font-semibold">Categorías de producto</h3>
          <div className="flex gap-2">
            <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nueva categoría" />
            <Button onClick={addCat}><Plus className="h-4 w-4" /></Button>
          </div>
          <ul className="divide-y rounded-md border">
            {cats.map((c: any) => (
              <li key={c.id} className="flex items-center justify-between p-2 text-sm">
                {c.name}
                <Button size="icon" variant="ghost" onClick={async () => {
                  if (!confirm("¿Eliminar categoría?")) return;
                  const { error } = await supabase.from("categories").delete().eq("id", c.id);
                  if (error) return toast.error(error.message);
                  qc.invalidateQueries({ queryKey: ["categories"] });
                }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </li>
            ))}
          </ul>
        </CardContent></Card>
      </div>
    </div>
  );
}

export default SettingsPage;
