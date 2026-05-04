import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/Page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/users")({ component: UsersPage });

const ROLES = ["admin", "vendedor", "produccion"] as const;

function UsersPage() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const profiles = (await supabase.from("profiles").select("*").order("created_at")).data ?? [];
      const roles = (await supabase.from("user_roles").select("*")).data ?? [];
      return profiles.map((p: any) => ({ ...p, role: roles.find((r: any) => r.user_id === p.id)?.role ?? null }));
    },
  });

  const setRole = async (userId: string, role: string) => {
    await supabase.from("user_roles").delete().eq("user_id", userId);
    if (role) {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: role as "admin" | "vendedor" | "produccion" });
      if (error) return toast.error(error.message);
    }
    toast.success("Rol actualizado");
    qc.invalidateQueries({ queryKey: ["users"] });
  };

  return (
    <div>
      <PageHeader title="Usuarios" subtitle="Asignación de roles. Los usuarios se crean al registrarse desde el login." />
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Usuario</TableHead><TableHead>Email</TableHead><TableHead>Rol</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.map((u: any) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {u.role && <Badge variant="secondary" className="capitalize">{u.role}</Badge>}
                    <Select value={u.role ?? ""} onValueChange={(v) => setRole(u.id, v)}>
                      <SelectTrigger className="w-44"><SelectValue placeholder="Asignar..." /></SelectTrigger>
                      <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
