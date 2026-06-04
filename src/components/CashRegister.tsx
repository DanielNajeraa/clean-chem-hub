import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { Lock, Unlock, Banknote, MinusCircle, ClipboardList } from "lucide-react";
import { toast } from "sonner";

type Session = {
  id: string; opening_amount: number; opened_at: string; status: string;
};

export function CashRegister() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [openDlg, setOpenDlg] = useState(false);
  const [opening, setOpening] = useState<number>(0);
  const [withdrawDlg, setWithdrawDlg] = useState(false);
  const [wAmount, setWAmount] = useState<number>(0);
  const [wReason, setWReason] = useState("");
  const [wType, setWType] = useState<"withdrawal" | "vale">("withdrawal");
  const [wBeneficiary, setWBeneficiary] = useState<string>("none");
  const [closeDlg, setCloseDlg] = useState(false);
  const [counted, setCounted] = useState<number>(0);
  const [closeNotes, setCloseNotes] = useState("");
  const [movDlg, setMovDlg] = useState(false);

  const { data: session } = useQuery({
    queryKey: ["cash-session", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("cash_sessions" as any)
        .select("*").eq("user_id", user!.id).eq("status", "open")
        .order("opened_at", { ascending: false }).limit(1).maybeSingle();
      return data as Session | null;
    },
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["cash-movements", session?.id],
    enabled: !!session?.id,
    queryFn: async () => (await supabase.from("cash_movements" as any).select("*").eq("session_id", session!.id).order("created_at")).data ?? [],
  });

  const { data: users = [] } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => (await supabase.from("profiles").select("id,full_name,email").order("full_name")).data ?? [],
  });

  const expected = (movements as any[]).reduce((s, m) => {
    if (["opening", "sale", "credit_payment", "deposit"].includes(m.movement_type)) return s + Number(m.amount);
    if (["withdrawal", "vale"].includes(m.movement_type)) return s - Number(m.amount);
    return s;
  }, 0);

  const summary = (movements as any[]).reduce((acc: any, m: any) => {
    acc[m.movement_type] = (acc[m.movement_type] ?? 0) + Number(m.amount); return acc;
  }, {});

  const doOpen = async () => {
    const { error } = await supabase.rpc("open_cash_session" as any, { _opening: opening } as any);
    if (error) return toast.error(error.message);
    toast.success("Caja abierta"); setOpenDlg(false); setOpening(0);
    qc.invalidateQueries({ queryKey: ["cash-session"] });
  };

  const doWithdraw = async () => {
    if (wAmount <= 0 || !wReason.trim()) return toast.error("Monto y motivo requeridos");
    const { error } = await supabase.rpc("register_cash_withdrawal" as any, {
      _amount: wAmount, _reason: wReason, _movement_type: wType,
      _beneficiary_user_id: wBeneficiary === "none" ? null : wBeneficiary,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Salida registrada"); setWithdrawDlg(false);
    setWAmount(0); setWReason(""); setWBeneficiary("none");
    qc.invalidateQueries({ queryKey: ["cash-movements"] });
  };

  const doClose = async () => {
    const { error } = await supabase.rpc("close_cash_session" as any, { _counted: counted, _notes: closeNotes || null } as any);
    if (error) return toast.error(error.message);
    toast.success("Caja cerrada. Diferencia: $" + (counted - expected).toFixed(2));
    setCloseDlg(false); setCounted(0); setCloseNotes("");
    qc.invalidateQueries({ queryKey: ["cash-session"] });
    qc.invalidateQueries({ queryKey: ["cash-movements"] });
  };

  if (!session) {
    return (
      <>
        <Card className="mb-4 border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-2 text-sm">
              <Lock className="h-4 w-4 text-warning" />
              <span>Caja cerrada — abre una sesión para registrar ventas en efectivo y salidas.</span>
            </div>
            <Button size="sm" onClick={() => setOpenDlg(true)} className="bg-warning text-warning-foreground hover:bg-warning/90">
              <Unlock className="mr-1 h-4 w-4" /> Abrir caja
            </Button>
          </CardContent>
        </Card>
        <Dialog open={openDlg} onOpenChange={setOpenDlg}>
          <DialogContent>
            <DialogHeader><DialogTitle>Abrir caja — Fondo inicial</DialogTitle></DialogHeader>
            <div><Label>Monto de fondo de caja</Label>
              <Input type="number" min={0} step="0.01" value={opening} onChange={(e) => setOpening(parseFloat(e.target.value) || 0)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenDlg(false)}>Cancelar</Button>
              <Button onClick={doOpen}>Abrir</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <Card className="mb-4 border-success/40 bg-success/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge className="bg-success text-success-foreground"><Unlock className="mr-1 h-3 w-3" />Caja abierta</Badge>
            <span className="text-muted-foreground">Abierta: {new Date(session.opened_at).toLocaleString()}</span>
            <span>Fondo: <strong>${Number(session.opening_amount).toFixed(2)}</strong></span>
            <span>Efectivo esperado: <strong className="text-success">${expected.toFixed(2)}</strong></span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setMovDlg(true)}><ClipboardList className="mr-1 h-4 w-4" />Movimientos</Button>
            <Button size="sm" variant="outline" onClick={() => setWithdrawDlg(true)}><MinusCircle className="mr-1 h-4 w-4" />Salida / Vale</Button>
            <Button size="sm" onClick={() => { setCloseDlg(true); setCounted(expected); }} className="bg-warning text-warning-foreground hover:bg-warning/90">
              <Lock className="mr-1 h-4 w-4" />Corte
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={withdrawDlg} onOpenChange={setWithdrawDlg}>
        <DialogContent>
          <DialogHeader><DialogTitle>Salida de efectivo</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tipo</Label>
                <Select value={wType} onValueChange={(v) => setWType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="withdrawal">Retiro</SelectItem>
                    <SelectItem value="vale">Vale empleado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Monto</Label>
                <Input type="number" min={0.01} step="0.01" value={wAmount} onChange={(e) => setWAmount(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            {wType === "vale" && (
              <div><Label>Empleado beneficiario</Label>
                <Select value={wBeneficiary} onValueChange={setWBeneficiary}>
                  <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Sin asignar —</SelectItem>
                    {users.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Motivo</Label>
              <Input value={wReason} onChange={(e) => setWReason(e.target.value)} placeholder={wType === "vale" ? "Ej. Adelanto de quincena" : "Ej. Gastos varios"} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawDlg(false)}>Cancelar</Button>
            <Button onClick={doWithdraw}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeDlg} onOpenChange={setCloseDlg}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Corte de caja</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Card className="bg-muted/40"><CardContent className="p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>Fondo apertura</span><span>${Number(summary.opening ?? 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Ventas efectivo</span><span className="text-success">+${Number(summary.sale ?? 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Abonos a crédito</span><span className="text-success">+${Number(summary.credit_payment ?? 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Depósitos</span><span className="text-success">+${Number(summary.deposit ?? 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Retiros</span><span className="text-destructive">−${Number(summary.withdrawal ?? 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Vales</span><span className="text-destructive">−${Number(summary.vale ?? 0).toFixed(2)}</span></div>
              <div className="flex justify-between border-t pt-2 font-bold"><span>Efectivo esperado</span><span>${expected.toFixed(2)}</span></div>
            </CardContent></Card>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Efectivo contado</Label>
                <Input type="number" min={0} step="0.01" value={counted} onChange={(e) => setCounted(parseFloat(e.target.value) || 0)} />
              </div>
              <div><Label>Diferencia</Label>
                <Input value={`$${(counted - expected).toFixed(2)}`} readOnly className={(counted - expected) === 0 ? "" : (counted - expected) > 0 ? "text-success font-bold" : "text-destructive font-bold"} />
              </div>
            </div>
            <div><Label>Notas</Label><Input value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="Opcional" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDlg(false)}>Cancelar</Button>
            <Button onClick={doClose} className="bg-warning text-warning-foreground hover:bg-warning/90"><Lock className="mr-1 h-4 w-4" />Cerrar caja</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={movDlg} onOpenChange={setMovDlg}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Movimientos de caja</DialogTitle></DialogHeader>
          <Table>
            <TableHeader><TableRow><TableHead>Hora</TableHead><TableHead>Tipo</TableHead><TableHead>Motivo</TableHead><TableHead className="text-right">Monto</TableHead></TableRow></TableHeader>
            <TableBody>
              {(movements as any[]).map((m: any) => {
                const isOut = ["withdrawal", "vale"].includes(m.movement_type);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs">{new Date(m.created_at).toLocaleTimeString()}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{m.movement_type}</Badge></TableCell>
                    <TableCell className="text-xs">{m.reason ?? "—"}</TableCell>
                    <TableCell className={`text-right font-medium ${isOut ? "text-destructive" : "text-success"}`}>{isOut ? "−" : "+"}${Number(m.amount).toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </>
  );
}
