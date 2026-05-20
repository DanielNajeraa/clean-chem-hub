import { useState, useMemo, Fragment } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Factory, AlertTriangle, CheckCircle2, Droplet, Beaker, Package } from "lucide-react";
import { toast } from "sonner";

const SUGG = [60, 100, 200];
const CONTAINER_OPTIONS = [1, 4, 5, 20];

function ProductionPage() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"product" | "raw_material">("product");

  // ============ Producto terminado ============
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState(200);
  const [containerSize, setContainerSize] = useState(20);

  // ============ Materia prima ============
  const [rmId, setRmId] = useState("");
  const [rmQty, setRmQty] = useState(50);

  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: products = [] } = useQuery({
    queryKey: ["products-with-formula"],
    queryFn: async () => (await supabase.from("products").select("id,name,stock,formula_id,unit_type").not("formula_id", "is", null).eq("unit_type", "litro").order("name")).data ?? [],
  });
  const { data: producibleRms = [] } = useQuery({
    queryKey: ["rms-producible"],
    queryFn: async () => (await supabase.from("raw_materials").select("id,name,stock,unit,formula_id,is_producible").eq("is_producible", true).not("formula_id", "is", null).order("name")).data ?? [],
  });
  const { data: orders = [] } = useQuery({
    queryKey: ["orders"], queryFn: async () =>
      (await supabase.from("production_orders").select("*, products(name), raw_materials(name,unit), profiles(full_name,email)").order("created_at", { ascending: false }).limit(50)).data ?? [],
  });

  // Fórmula del item seleccionado (producto o MP)
  const selectedFormulaId = kind === "product"
    ? (products.find((p: any) => p.id === productId)?.formula_id ?? null)
    : (producibleRms.find((r: any) => r.id === rmId)?.formula_id ?? null);
  const selectedQty = kind === "product" ? qty : rmQty;

  const { data: formulaItems } = useQuery({
    enabled: !!selectedFormulaId,
    queryKey: ["formula-check", selectedFormulaId],
    queryFn: async () => (await supabase.from("formula_items").select("*, raw_materials(name,stock,cost_per_unit,unit)").eq("formula_id", selectedFormulaId!)).data ?? [],
  });
  const { data: orderContainers = [] } = useQuery({
    enabled: !!expanded,
    queryKey: ["order-containers", expanded],
    queryFn: async () => (await supabase.from("inventory_containers").select("*").eq("production_order_id", expanded!).order("filled_at")).data ?? [],
  });

  const requirements = useMemo(() => {
    if (!formulaItems) return [];
    return formulaItems.map((i: any) => {
      const need = Number(i.quantity) * selectedQty;
      const ok = Number(i.raw_materials?.stock ?? 0) >= need;
      return {
        name: i.raw_materials?.name, unit: i.unit, need, available: Number(i.raw_materials?.stock ?? 0),
        cost: need * Number(i.raw_materials?.cost_per_unit ?? 0), ok,
      };
    });
  }, [formulaItems, selectedQty]);
  const totalCost = requirements.reduce((s, r) => s + r.cost, 0);
  const canProduce = requirements.length > 0 && requirements.every((r) => r.ok);

  const containerPreview = useMemo(() => {
    const size = containerSize > 0 ? containerSize : 20;
    const full = Math.floor(qty / size);
    const remainder = +(qty - full * size).toFixed(2);
    return { full, remainder, size };
  }, [qty, containerSize]);

  const startProduct = async () => {
    if (!productId) return toast.error("Selecciona producto");
    if (!canProduce) return toast.error("Materia prima insuficiente");
    if (containerSize <= 0) return toast.error("Tamaño de garrafón inválido");
    setSubmitting(true);
    const { error } = await supabase.rpc("process_production", { _product_id: productId, _quantity: qty, _container_liters: containerSize } as any);
    setSubmitting(false);
    if (error) return toast.error(error.message);
    const productName = products.find((p: any) => p.id === productId)?.name;
    const summary = `${containerPreview.full} garrafones de ${containerPreview.size}L${containerPreview.remainder > 0 ? ` + 1 de ${containerPreview.remainder}L` : ""}`;
    toast.success(`Se generaron ${summary} de ${productName}`);
    setProductId(""); setQty(200);
    invalidate();
  };

  const startRawMaterial = async () => {
    if (!rmId) return toast.error("Selecciona materia prima");
    if (!canProduce) return toast.error("Materia prima insuficiente");
    setSubmitting(true);
    const { error } = await supabase.rpc("process_raw_material_production" as any, { _raw_material_id: rmId, _quantity: rmQty } as any);
    setSubmitting(false);
    if (error) return toast.error(error.message);
    const rm = producibleRms.find((r: any) => r.id === rmId);
    toast.success(`Se produjeron ${rmQty} ${rm?.unit ?? ""} de ${rm?.name ?? ""}`);
    setRmId(""); setRmQty(50);
    invalidate();
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["rms-full"] });
    qc.invalidateQueries({ queryKey: ["rms-producible"] });
    qc.invalidateQueries({ queryKey: ["products-with-formula"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product-stock-liters"] });
    qc.invalidateQueries({ queryKey: ["pos-stock"] });
    qc.invalidateQueries({ queryKey: ["movs"] });
  };

  return (
    <div>
      <PageHeader title="Órdenes de producción" subtitle="Fabrica productos terminados o materia prima interna" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-4 p-6">
            <Tabs value={kind} onValueChange={(v) => setKind(v as any)}>
              <TabsList className="w-full">
                <TabsTrigger value="product" className="flex-1"><Package className="mr-2 h-4 w-4" />Producto terminado</TabsTrigger>
                <TabsTrigger value="raw_material" className="flex-1"><Beaker className="mr-2 h-4 w-4" />Materia prima</TabsTrigger>
              </TabsList>

              <TabsContent value="product" className="space-y-4 pt-4">
                <div><Label>Producto a fabricar</Label>
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger><SelectValue placeholder="Selecciona producto" /></SelectTrigger>
                    <SelectContent>{products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Litros a producir</Label>
                  <Input type="number" min={1} step="1" value={qty} onChange={(e) => setQty(parseFloat(e.target.value) || 0)} />
                  <div className="mt-2 flex gap-2">
                    {SUGG.map((v) => <Button key={v} type="button" size="sm" variant={qty === v ? "default" : "outline"} onClick={() => setQty(v)}>{v}L</Button>)}
                  </div>
                </div>
                <div>
                  <Label>Tamaño de garrafón</Label>
                  <Input type="number" min={0.1} step="0.1" value={containerSize} onChange={(e) => setContainerSize(parseFloat(e.target.value) || 0)} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {CONTAINER_OPTIONS.map((v) => <Button key={v} type="button" size="sm" variant={containerSize === v ? "default" : "outline"} onClick={() => setContainerSize(v)}>{v}L</Button>)}
                  </div>
                </div>
                {qty > 0 && containerSize > 0 && (
                  <div className="rounded-md border bg-primary/5 p-3 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <Droplet className="h-4 w-4 text-primary" />
                      Se generarán {containerPreview.full} garrafones de {containerPreview.size}L
                      {containerPreview.remainder > 0 && ` + 1 de ${containerPreview.remainder}L (parcial)`}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="raw_material" className="space-y-4 pt-4">
                <div><Label>Materia prima a fabricar</Label>
                  <Select value={rmId} onValueChange={setRmId}>
                    <SelectTrigger><SelectValue placeholder="Selecciona materia prima" /></SelectTrigger>
                    <SelectContent>
                      {producibleRms.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">Marca alguna materia prima como "se fabrica internamente" y asígnale fórmula.</div>}
                      {producibleRms.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name} ({r.unit})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cantidad a producir {rmId && `(${producibleRms.find((r: any) => r.id === rmId)?.unit})`}</Label>
                  <Input type="number" min={0.01} step="0.01" value={rmQty} onChange={(e) => setRmQty(parseFloat(e.target.value) || 0)} />
                </div>
                <p className="text-xs text-muted-foreground">Esta producción consumirá insumos según la fórmula y aumentará el stock de la materia prima generada. No genera garrafones.</p>
              </TabsContent>
            </Tabs>

            {requirements.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Insumo</TableHead><TableHead>Necesita</TableHead><TableHead>Disponible</TableHead><TableHead>Costo</TableHead></TableRow></TableHeader>
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

            <Button onClick={kind === "product" ? startProduct : startRawMaterial} disabled={submitting || !canProduce} className="w-full bg-warning text-warning-foreground hover:bg-warning/90">
              <Factory className="mr-2 h-4 w-4" /> Iniciar producción
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h3 className="mb-3 font-semibold">Historial de órdenes</h3>
            <Table>
              <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Tipo</TableHead><TableHead>Item</TableHead><TableHead>Cant.</TableHead><TableHead>Costo</TableHead><TableHead>Usuario</TableHead></TableRow></TableHeader>
              <TableBody>
                {orders.map((o: any) => {
                  const isRm = !!o.raw_material_id;
                  return (
                    <Fragment key={o.id}>
                      <TableRow className="cursor-pointer" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                        <TableCell className="text-xs">{new Date(o.created_at).toLocaleString()}</TableCell>
                        <TableCell>
                          {isRm
                            ? <Badge variant="outline" className="bg-primary/10"><Beaker className="mr-1 h-3 w-3" />MP</Badge>
                            : <Badge variant="outline" className="bg-success/10"><Package className="mr-1 h-3 w-3" />Prod.</Badge>}
                        </TableCell>
                        <TableCell>{isRm ? o.raw_materials?.name : o.products?.name}</TableCell>
                        <TableCell>{Number(o.quantity)} {isRm ? o.raw_materials?.unit : "L"}</TableCell>
                        <TableCell>${Number(o.total_cost).toFixed(2)}</TableCell>
                        <TableCell className="text-xs">{o.profiles?.full_name || o.profiles?.email || "—"}</TableCell>
                      </TableRow>
                      {expanded === o.id && !isRm && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/30 p-3">
                            <p className="mb-2 text-xs font-semibold text-muted-foreground">Garrafones generados ({orderContainers.length})</p>
                            <div className="flex flex-wrap gap-1">
                              {orderContainers.map((c: any, i: number) => (
                                <Badge key={c.id} variant="outline" className={
                                  c.status === "full" ? "bg-success/10" : c.status === "partial" ? "bg-warning/10" : "opacity-50"
                                }>
                                  #{i + 1} · {Number(c.liters_available)}/{Number(c.liters_initial)}L · {c.status}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {expanded === o.id && isRm && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/30 p-3 text-xs text-muted-foreground">
                            Se sumaron {Number(o.quantity)} {o.raw_materials?.unit} al inventario de {o.raw_materials?.name}. Los insumos consumidos quedan registrados en Movimientos de materia prima.
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default ProductionPage;
