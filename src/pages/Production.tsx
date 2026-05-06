import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Factory, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

function ProductionPage() {
  const qc = useQueryClient();
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["products-with-formula"],
    queryFn: async () => (await supabase.from("products").select("id,name,stock,formula_id,is_bulk").not("formula_id", "is", null).order("name")).data ?? [],
  });
  const { data: orders = [] } = useQuery({
    queryKey: ["orders"], queryFn: async () => (await supabase.from("production_orders").select("*, products(name)").order("created_at", { ascending: false }).limit(50)).data ?? [],
  });

  const { data: formulaCheck } = useQuery({
    enabled: !!productId,
    queryKey: ["formula-check", productId],
    queryFn: async () => {
      const p = products.find((x: any) => x.id === productId);
      if (!p?.formula_id) return null;
      const { data: items } = await supabase.from("formula_items").select("*, raw_materials(name,stock,cost_per_unit,unit)").eq("formula_id", p.formula_id);
      return items ?? [];
    },
  });

  const requirements = useMemo(() => {
    if (!formulaCheck) return [];
    return formulaCheck.map((i: any) => {
      const need = Number(i.quantity) * qty;
      const ok = Number(i.raw_materials?.stock ?? 0) >= need;
      return {
        name: i.raw_materials?.name, unit: i.unit, need, available: Number(i.raw_materials?.stock ?? 0),
        cost: need * Number(i.raw_materials?.cost_per_unit ?? 0), ok,
      };
    });
  }, [formulaCheck, qty]);
  const totalCost = requirements.reduce((s, r) => s + r.cost, 0);
  const canProduce = requirements.length > 0 && requirements.every((r) => r.ok);

  const start = async () => {
    if (!productId) return toast.error("Selecciona producto");
    if (!canProduce) return toast.error("Materia prima insuficiente");
    setSubmitting(true);
    const { error } = await supabase.rpc("process_production", { _product_id: productId, _quantity: qty });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Producción registrada");
    setProductId(""); setQty(1);
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["rms-full"] });
    qc.invalidateQueries({ queryKey: ["products-with-formula"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  return (
    <div>
      <PageHeader title="Órdenes de producción" subtitle="Fabrica lotes y descuenta materia prima automáticamente" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-4 p-6">
            <h3 className="font-semibold">Nueva orden</h3>
            <div><Label>Producto a fabricar</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Selecciona producto" /></SelectTrigger>
                <SelectContent>{products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name} {p.is_bulk ? "(granel)" : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Cantidad a producir</Label><Input type="number" min={1} step="0.01" value={qty} onChange={(e) => setQty(parseFloat(e.target.value) || 0)} /></div>

            {requirements.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Insumo</TableHead><TableHead>Necesario</TableHead><TableHead>Disponible</TableHead><TableHead>Costo</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {requirements.map((r) => (
                      <TableRow key={r.name}>
                        <TableCell>{r.name} {r.ok ? <CheckCircle2 className="ml-1 inline h-3 w-3 text-success" /> : <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" />}</TableCell>
                        <TableCell>{r.need.toFixed(2)} {r.unit}</TableCell>
                        <TableCell className={r.ok ? "" : "text-destructive font-medium"}>{r.available} {r.unit}</TableCell>
                        <TableCell>${r.cost.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-between border-t p-3 text-sm font-semibold">
                  <span>Costo total estimado</span><span className="text-success">${totalCost.toFixed(2)}</span>
                </div>
              </div>
            )}

            <Button onClick={start} disabled={submitting || !canProduce} className="w-full bg-warning text-warning-foreground hover:bg-warning/90">
              <Factory className="mr-2 h-4 w-4" /> Iniciar producción
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h3 className="mb-3 font-semibold">Historial de órdenes</h3>
            <Table>
              <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Producto</TableHead><TableHead>Cant.</TableHead><TableHead>Costo</TableHead></TableRow></TableHeader>
              <TableBody>
                {orders.map((o: any) => (
                  <TableRow key={o.id}>
                    <TableCell className="text-xs">{new Date(o.created_at).toLocaleString()}</TableCell>
                    <TableCell>{o.products?.name}</TableCell>
                    <TableCell>{Number(o.quantity)}</TableCell>
                    <TableCell>${Number(o.total_cost).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default ProductionPage;
