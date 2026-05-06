import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, ShoppingCart, Package, FlaskConical, Beaker,
  Factory, Users, Receipt, Settings, LogOut, UserCog, Sparkles,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth, type AppRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";

type Item = { title: string; url: string; icon: typeof LayoutDashboard; roles: AppRole[] };

const items: Item[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, roles: ["admin","vendedor","produccion"] },
  { title: "POS", url: "/pos", icon: ShoppingCart, roles: ["admin","vendedor"] },
  { title: "Productos", url: "/products", icon: Package, roles: ["admin","vendedor"] },
  { title: "Fórmulas", url: "/formulas", icon: FlaskConical, roles: ["admin"] },
  { title: "Materia Prima", url: "/raw-materials", icon: Beaker, roles: ["admin","produccion"] },
  { title: "Producción", url: "/production", icon: Factory, roles: ["admin","produccion"] },
  { title: "Clientes", url: "/customers", icon: Users, roles: ["admin","vendedor"] },
  { title: "Tickets", url: "/tickets", icon: Receipt, roles: ["admin","vendedor"] },
  { title: "Usuarios", url: "/users", icon: UserCog, roles: ["admin"] },
  { title: "Configuración", url: "/settings", icon: Settings, roles: ["admin"] },
];

export function AppSidebar() {
  const { role, user, signOut } = useAuth();
  const { pathname } = useLocation();
  const visible = items.filter((i) => role && i.roles.includes(role));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-success text-success-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-sidebar-foreground">CleanFab</span>
            <span className="text-[11px] text-sidebar-foreground/60 capitalize">{role ?? ""}</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visible.map((item) => {
                const active = pathname === item.url;
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex flex-col gap-2 p-2">
          <span className="truncate px-2 text-[11px] text-sidebar-foreground/60">{user?.email}</span>
          <Button variant="secondary" size="sm" onClick={() => signOut()} className="justify-start">
            <LogOut className="mr-2 h-4 w-4" /> Cerrar sesión
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
