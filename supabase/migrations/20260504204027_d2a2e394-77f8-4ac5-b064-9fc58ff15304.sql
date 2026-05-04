
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin','vendedor','produccion');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role) $$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role FROM public.user_roles WHERE user_id=_user_id ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'produccion' THEN 2 WHEN 'vendedor' THEN 3 END LIMIT 1 $$;

-- Auto profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name',''));
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Domain tables
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE
);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.raw_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  stock NUMERIC NOT NULL DEFAULT 0,
  cost_per_unit NUMERIC NOT NULL DEFAULT 0,
  reorder_point NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.formulas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.formulas ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.formula_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_id UUID NOT NULL REFERENCES public.formulas(id) ON DELETE CASCADE,
  raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL
);
ALTER TABLE public.formula_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  presentation TEXT NOT NULL,
  unit_type TEXT NOT NULL DEFAULT 'unidad', -- 'unidad' or 'litro'
  is_bulk BOOLEAN NOT NULL DEFAULT false,
  price NUMERIC NOT NULL DEFAULT 0,
  image_url TEXT,
  stock NUMERIC NOT NULL DEFAULT 0,
  formula_id UUID REFERENCES public.formulas(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  type TEXT NOT NULL DEFAULT 'minorista',
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.production_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity NUMERIC NOT NULL,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id),
  movement_type TEXT NOT NULL, -- 'in' or 'out'
  quantity NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.customers(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  payment_method TEXT NOT NULL,
  subtotal NUMERIC NOT NULL,
  discount NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  product_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit_price NUMERIC NOT NULL,
  subtotal NUMERIC NOT NULL
);
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.settings (
  id INT PRIMARY KEY DEFAULT 1,
  business_name TEXT NOT NULL DEFAULT 'Mi Negocio',
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  discount_threshold INT NOT NULL DEFAULT 3,
  discount_percent NUMERIC NOT NULL DEFAULT 5,
  CONSTRAINT singleton CHECK (id = 1)
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.settings (id) VALUES (1);

-- RLS Policies
-- profiles: user reads own; admin reads all
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- user_roles: user reads own; admin manages all
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- categories: read all auth, admin manage
CREATE POLICY "auth read cat" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write cat" ON public.categories FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- raw_materials: admin+produccion read & write
CREATE POLICY "rm read" ON public.raw_materials FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion'));
CREATE POLICY "rm write" ON public.raw_materials FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion'));

-- formulas: admin only
CREATE POLICY "formula admin" ON public.formulas FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "formula read prod" ON public.formulas FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'produccion'));
CREATE POLICY "fitems admin" ON public.formula_items FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "fitems read prod" ON public.formula_items FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'produccion'));

-- products: all auth read, admin write, produccion update stock
CREATE POLICY "products read" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products admin" ON public.products FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "products prod update" ON public.products FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'produccion')) WITH CHECK (public.has_role(auth.uid(),'produccion'));

-- customers: admin+vendedor
CREATE POLICY "cust read" ON public.customers FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "cust write" ON public.customers FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));

-- production orders: admin+produccion
CREATE POLICY "po read" ON public.production_orders FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion'));
CREATE POLICY "po insert" ON public.production_orders FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion')) AND user_id = auth.uid());

-- inventory movements
CREATE POLICY "inv read" ON public.inventory_movements FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion'));
CREATE POLICY "inv insert" ON public.inventory_movements FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion'));

-- sales: admin+vendedor
CREATE POLICY "sales read" ON public.sales FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "sales insert" ON public.sales FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) AND user_id = auth.uid());
CREATE POLICY "si read" ON public.sale_items FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "si insert" ON public.sale_items FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));

-- settings: read auth, write admin
CREATE POLICY "settings read" ON public.settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings admin" ON public.settings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Atomic POS checkout function
CREATE OR REPLACE FUNCTION public.process_sale(
  _customer_id UUID,
  _payment_method TEXT,
  _subtotal NUMERIC,
  _discount NUMERIC,
  _total NUMERIC,
  _items JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sale_id UUID;
  _item JSONB;
  _current_stock NUMERIC;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Validate stock
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT stock INTO _current_stock FROM products WHERE id = (_item->>'product_id')::UUID FOR UPDATE;
    IF _current_stock < (_item->>'quantity')::NUMERIC THEN
      RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, solicitado: %)',
        _item->>'product_name', _current_stock, _item->>'quantity';
    END IF;
  END LOOP;

  INSERT INTO sales (customer_id, user_id, payment_method, subtotal, discount, total)
  VALUES (_customer_id, auth.uid(), _payment_method, _subtotal, _discount, _total)
  RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal)
    VALUES (_sale_id, (_item->>'product_id')::UUID, _item->>'product_name',
            (_item->>'quantity')::NUMERIC, (_item->>'unit_price')::NUMERIC, (_item->>'subtotal')::NUMERIC);
    UPDATE products SET stock = stock - (_item->>'quantity')::NUMERIC
    WHERE id = (_item->>'product_id')::UUID;
  END LOOP;

  RETURN _sale_id;
END; $$;

-- Atomic production function
CREATE OR REPLACE FUNCTION public.process_production(
  _product_id UUID,
  _quantity NUMERIC
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _formula_id UUID;
  _order_id UUID;
  _total_cost NUMERIC := 0;
  _item RECORD;
  _needed NUMERIC;
  _avail NUMERIC;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion')) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT formula_id INTO _formula_id FROM products WHERE id = _product_id;
  IF _formula_id IS NULL THEN RAISE EXCEPTION 'Producto sin fórmula asociada'; END IF;

  -- Validate stock
  FOR _item IN SELECT fi.raw_material_id, fi.quantity, rm.stock, rm.cost_per_unit, rm.name
               FROM formula_items fi JOIN raw_materials rm ON rm.id = fi.raw_material_id
               WHERE fi.formula_id = _formula_id LOOP
    _needed := _item.quantity * _quantity;
    IF _item.stock < _needed THEN
      RAISE EXCEPTION 'Materia prima insuficiente: % (necesita %, disponible %)', _item.name, _needed, _item.stock;
    END IF;
    _total_cost := _total_cost + (_needed * _item.cost_per_unit);
  END LOOP;

  INSERT INTO production_orders (product_id, quantity, total_cost, user_id)
  VALUES (_product_id, _quantity, _total_cost, auth.uid())
  RETURNING id INTO _order_id;

  FOR _item IN SELECT fi.raw_material_id, fi.quantity, rm.name
               FROM formula_items fi JOIN raw_materials rm ON rm.id = fi.raw_material_id
               WHERE fi.formula_id = _formula_id LOOP
    _needed := _item.quantity * _quantity;
    UPDATE raw_materials SET stock = stock - _needed WHERE id = _item.raw_material_id;
    INSERT INTO inventory_movements (raw_material_id, movement_type, quantity, reason, user_id)
    VALUES (_item.raw_material_id, 'out', _needed, 'Producción Lote #' || substring(_order_id::text,1,8), auth.uid());
  END LOOP;

  UPDATE products SET stock = stock + _quantity WHERE id = _product_id;

  RETURN _order_id;
END; $$;
