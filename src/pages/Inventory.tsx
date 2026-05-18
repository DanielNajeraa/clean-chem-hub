import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ChevronDown, ChevronRight, Droplet } from "lucide-react";
import { cn } from "@/lib/utils";

type StockRow = {
  product_id: string;
  product_name: string;
  total_liters_available: number;
  containers_full: number;
  containers_partial: number;
  containers_empty: number;
  containers_active: number;
};

function InventoryPage() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);

  const { data: stock = [] } = useQuery({
    queryKey: ["product-stock-liters"],
    queryFn: async () => {
      const { data } = await supabase.from("product_stock_liters" as any).select("*").order("product_name");
      return (data ?? []) as unknown as StockRow[];
    },
  });

  const { data: containers = [] } = useQuery({
    enabled: !!expanded,
    queryKey: ["containers", expanded, showEmpty],
    queryFn: async () => {
      let q = supabase.from("inventory_containers").select("*").eq("product_id", expanded!).order("filled_at", { ascending: true });
      if (!showEmpty) q = q.neq("status", "empty");
      return (await q).data ?? [];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("inv-containers")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_containers" }, () => {
        qc.invalidateQueries({ queryKey: ["product-stock-liters"] });
        qc.invalidateQueries({ queryKey: ["containers"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const alerts = stock.filter((s) => Number(s.total_liters_available) === 0 || Number(s.total_liters_available) < 40);

  return (
    <div>
      <PageHeader title="Inventario de garrafones" subtitle="Estado en tiempo real por producto (FIFO)" />

      {alerts.length > 0 && (
        <div className="mb-4 space-y-2">
          {alerts.map((s) => {
            const empty = Number(s.total_liters_available) === 0;
            return (
              <Alert key={s.product_id} variant={empty ? "destructive" : "default"} className={empty ? "" : "border-warning/40 bg-warning/10"}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {empty ? "Sin stock" : "Stock bajo"}: <strong>{s.product_name}</strong> — {Number(s.total_liters_available).toFixed(1)} L
                </AlertDescription>
              </Alert>
            );
          })}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stock.map((s) => {
          const liters = Number(s.total_liters_available);
          const color = liters === 0 ? "border-destructive/50 bg-destructive/5" : liters < 40 ? "border-warning/50 bg-warning/5" : "border-success/50 bg-success/5";
          const open = expanded === s.product_id;
          return (
            <Card key={s.product_id} className={cn("cursor-pointer transition hover:shadow-md", color)}
              onClick={() => setExpanded(open ? null : s.product_id)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{s.product_name}</h3>
                    <div className="mt-1 flex items-baseline gap-1">
                      <Droplet className="h-5 w-5 text-primary" />
                      <span className="text-3xl font-bold">{liters.toFixed(1)}</span>
                      <span className="text-sm text-muted-foreground">L</span>
                    </div>
                  </div>
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline" className="bg-success/10">{s.containers_full} llenos</Badge>
                  <Badge variant="outline" className="bg-warning/10">{s.containers_partial} parciales</Badge>
                  <Badge variant="outline">{s.containers_empty} vacíos</Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {expanded && (
        <Card className="mt-4">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Garrafones — {stock.find((s) => s.product_id === expanded)?.product_name}</h3>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={showEmpty} onCheckedChange={setShowEmpty} />
                Mostrar vacíos
              </label>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Llenado</TableHead><TableHead>Inicial</TableHead>
                  <TableHead>Disponible</TableHead><TableHead>% restante</TableHead><TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containers.map((c: any, idx: number) => {
                  const pct = Math.round((Number(c.liters_available) / Number(c.liters_initial)) * 100);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="text-xs">{new Date(c.filled_at).toLocaleString()}</TableCell>
                      <TableCell>{Number(c.liters_initial)} L</TableCell>
                      <TableCell>{Number(c.liters_available)} L</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 rounded bg-muted overflow-hidden">
                            <div className={cn("h-full", pct > 50 ? "bg-success" : pct > 0 ? "bg-warning" : "bg-destructive")} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs">{pct}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {c.status === "full" ? <Badge className="bg-success text-success-foreground">Lleno</Badge>
                          : c.status === "partial" ? <Badge className="bg-warning text-warning-foreground">Parcial</Badge>
                          : <Badge variant="outline">Vacío</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default InventoryPage;
