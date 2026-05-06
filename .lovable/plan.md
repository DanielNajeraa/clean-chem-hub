
## Objetivo
Adaptar el proyecto para que se pueda hacer deploy en **Vercel** como Vite SPA estándar, conservando toda la funcionalidad existente (auth, POS, producción, inventario, etc.).

## Por qué requiere refactor
El proyecto actual usa **TanStack Start** con adaptador **Cloudflare Workers** (configurado dentro de `@lovable.dev/vite-tanstack-config`). Vercel necesita una salida estática (`dist/`) servida como SPA — el formato Worker no es compatible.

## Cambios

### 1. Stack
- **Quitar:** `@tanstack/react-start`, `@tanstack/router-plugin`, `@tanstack/react-router` (file-based), `@cloudflare/vite-plugin`, `@lovable.dev/vite-tanstack-config`, `wrangler.jsonc`.
- **Añadir:** `react-router-dom` v6, `@vitejs/plugin-react`, configuración Vite SPA limpia.
- Crear `vite.config.ts` propio con Tailwind v4 plugin, alias `@`, plugin de React.

### 2. Routing
- Borrar `src/routes/` y `src/routeTree.gen.ts`, `src/router.tsx`.
- Crear `src/main.tsx` (entry SPA), `src/App.tsx` con `<BrowserRouter>` y `<Routes>`.
- Convertir cada ruta de TanStack a una página normal en `src/pages/`:
  - `/login`, `/dashboard`, `/pos`, `/production`, `/products`, `/formulas`, `/raw-materials`, `/customers`, `/tickets`, `/users`, `/settings`.
- Reemplazar imports `@tanstack/react-router` → `react-router-dom` (`Link`, `useNavigate`, `Outlet`, `useParams`).
- Crear `src/components/AppLayout.tsx` con el sidebar y `<Outlet/>` (equivalente al actual `_app.tsx`).
- Crear `ProtectedRoute` para rutas que requieren login + rol.

### 3. Backend
- **Eliminar** `src/integrations/supabase/auth-middleware.ts` y `client.server.ts` (no se usan en los componentes; toda la lógica ya está en RPC functions de Postgres).
- Mantener `src/integrations/supabase/client.ts` tal cual.
- Toda la lógica de negocio sigue en Supabase (RPC `process_sale`, `process_production`) — sin cambios.

### 4. HTML / index.html
- Crear `index.html` en raíz con `<div id="root">` y meta tags SEO actuales.
- Mover el `<head>` content del `__root.tsx` a `index.html`.

### 5. Vercel config
- Mantener `vercel.json` ya existente (rewrites a `index.html` para SPA).
- Cambiar `outputDirectory` a `dist` (no `dist/client`).

### 6. .env / variables en Vercel
Documentar que el usuario debe añadir en Vercel Settings → Environment Variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

## Riesgos
- **Pierdes SSR** y server functions de TanStack Start. No hay impacto porque la app actual es 100% client-side con Supabase como backend.
- El preview de Lovable seguirá funcionando porque Vite SPA funciona en ambos entornos.

## Resultado
- `bun run build` produce `dist/` listo para Vercel.
- Deploy: conectar repo a Vercel, framework "Vite", build command `npm run build`, output `dist`.
- Login con la cuenta admin ya creada (`admin@cleanfab.com` / `Admin1234`) seguirá funcionando.

¿Procedo con la migración?
