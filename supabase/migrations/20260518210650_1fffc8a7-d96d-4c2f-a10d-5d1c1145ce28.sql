
-- =====================================================
-- 1. product_presentations
-- =====================================================
CREATE TABLE public.product_presentations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  label text NOT NULL,
  liters numeric NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  is_bulk boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pp_product ON public.product_presentations(product_id);
ALTER TABLE public.product_presentations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pp read" ON public.product_presentations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "pp admin write" ON public.product_presentations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

GRANT ALL ON public.product_presentations TO authenticated, service_role, anon;

-- =====================================================
-- 2. inventory_containers
-- =====================================================
CREATE TABLE public.inventory_containers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE RESTRICT,
  liters_initial numeric NOT NULL,
  liters_available numeric NOT NULL,
  status text NOT NULL DEFAULT 'full',
  filled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ic_liters_check CHECK (liters_available >= 0 AND liters_available <= liters_initial),
  CONSTRAINT ic_status_check CHECK (status IN ('full','partial','empty'))
);
CREATE INDEX idx_ic_product_fifo ON public.inventory_containers(product_id, filled_at) WHERE status <> 'empty';
ALTER TABLE public.inventory_containers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ic read" ON public.inventory_containers
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "ic insert" ON public.inventory_containers
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion'));
CREATE POLICY "ic update" ON public.inventory_containers
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion') OR public.has_role(auth.uid(),'vendedor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion') OR public.has_role(auth.uid(),'vendedor'));

GRANT ALL ON public.inventory_containers TO authenticated, service_role, anon;

-- =====================================================
-- 3. sale_container_items
-- =====================================================
CREATE TABLE public.sale_container_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  presentation_id uuid REFERENCES public.product_presentations(id),
  container_id uuid NOT NULL REFERENCES public.inventory_containers(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  liters_dispatched numeric NOT NULL,
  unit_price numeric NOT NULL,
  subtotal numeric NOT NULL,
  dispatch_type text NOT NULL,
  CONSTRAINT sci_dispatch_check CHECK (dispatch_type IN ('20L','5L','1L','granel','otro'))
);
CREATE INDEX idx_sci_sale ON public.sale_container_items(sale_id);
ALTER TABLE public.sale_container_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sci read" ON public.sale_container_items
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "sci insert" ON public.sale_container_items
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));

GRANT ALL ON public.sale_container_items TO authenticated, service_role, anon;

-- =====================================================
-- 4. VIEW product_stock_liters
-- =====================================================
CREATE OR REPLACE VIEW public.product_stock_liters AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  COALESCE(SUM(CASE WHEN ic.status <> 'empty' THEN ic.liters_available ELSE 0 END), 0) AS total_liters_available,
  COUNT(*) FILTER (WHERE ic.status = 'full') AS containers_full,
  COUNT(*) FILTER (WHERE ic.status = 'partial') AS containers_partial,
  COUNT(*) FILTER (WHERE ic.status = 'empty') AS containers_empty,
  COUNT(*) FILTER (WHERE ic.status <> 'empty') AS containers_active
FROM public.products p
LEFT JOIN public.inventory_containers ic ON ic.product_id = p.id
GROUP BY p.id, p.name;

GRANT SELECT ON public.product_stock_liters TO authenticated, service_role, anon;

-- =====================================================
-- 5. process_production (REEMPLAZA - ahora genera garrafones)
-- =====================================================
CREATE OR REPLACE FUNCTION public.process_production(_product_id uuid, _quantity numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _formula_id UUID;
  _order_id UUID;
  _total_cost NUMERIC := 0;
  _item RECORD;
  _needed NUMERIC;
  _full_containers INT;
  _remainder NUMERIC;
  _i INT;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion')) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT formula_id INTO _formula_id FROM products WHERE id = _product_id;
  IF _formula_id IS NULL THEN RAISE EXCEPTION 'Producto sin fórmula asociada'; END IF;

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

  -- Generar garrafones de 20L
  _full_containers := FLOOR(_quantity / 20)::INT;
  _remainder := _quantity - (_full_containers * 20);

  FOR _i IN 1.._full_containers LOOP
    INSERT INTO inventory_containers (product_id, production_order_id, liters_initial, liters_available, status)
    VALUES (_product_id, _order_id, 20, 20, 'full');
  END LOOP;

  IF _remainder > 0 THEN
    INSERT INTO inventory_containers (product_id, production_order_id, liters_initial, liters_available, status)
    VALUES (_product_id, _order_id, _remainder, _remainder, 'partial');
  END IF;

  RETURN _order_id;
END; $function$;

-- =====================================================
-- 6. process_liquid_sale (NUEVA)
-- =====================================================
CREATE OR REPLACE FUNCTION public.process_liquid_sale(
  _customer_id uuid,
  _payment_method text,
  _subtotal numeric,
  _discount numeric,
  _total numeric,
  _items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _sale_id UUID;
  _item JSONB;
  _product_id UUID;
  _liters NUMERIC;
  _available NUMERIC;
  _product_name TEXT;
  _container RECORD;
  _remaining NUMERIC;
  _take NUMERIC;
  _new_status TEXT;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Validar stock total por producto (sumando litros pedidos del mismo producto)
  FOR _item IN
    SELECT jsonb_build_object('product_id', product_id, 'liters', SUM(liters)) AS j
    FROM jsonb_to_recordset(_items) AS x(product_id uuid, liters numeric)
    GROUP BY product_id
  LOOP
    _product_id := (_item->>'product_id')::uuid;
    _liters := (_item->>'liters')::numeric;
    SELECT COALESCE(SUM(liters_available),0), MAX(name)
      INTO _available, _product_name
    FROM inventory_containers ic
    JOIN products p ON p.id = ic.product_id
    WHERE ic.product_id = _product_id AND ic.status <> 'empty';
    IF _available < _liters THEN
      RAISE EXCEPTION 'Stock insuficiente para % (disponible: % L, solicitado: % L)', COALESCE(_product_name,'producto'), _available, _liters;
    END IF;
  END LOOP;

  -- Crear venta
  INSERT INTO sales (customer_id, user_id, payment_method, subtotal, discount, total)
  VALUES (_customer_id, auth.uid(), _payment_method, _subtotal, _discount, _total)
  RETURNING id INTO _sale_id;

  -- Procesar cada item con FIFO
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _product_id := (_item->>'product_id')::uuid;
    _remaining := (_item->>'liters')::numeric;

    FOR _container IN
      SELECT id, liters_available, liters_initial
      FROM inventory_containers
      WHERE product_id = _product_id AND status <> 'empty'
      ORDER BY filled_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN _remaining <= 0;
      _take := LEAST(_remaining, _container.liters_available);

      IF (_container.liters_available - _take) <= 0 THEN
        _new_status := 'empty';
      ELSIF (_container.liters_available - _take) < _container.liters_initial THEN
        _new_status := 'partial';
      ELSE
        _new_status := 'full';
      END IF;

      UPDATE inventory_containers
        SET liters_available = liters_available - _take,
            status = _new_status
        WHERE id = _container.id;

      INSERT INTO sale_container_items (sale_id, presentation_id, container_id, product_id, liters_dispatched, unit_price, subtotal, dispatch_type)
      VALUES (
        _sale_id,
        NULLIF(_item->>'presentation_id','')::uuid,
        _container.id,
        _product_id,
        _take,
        (_item->>'unit_price')::numeric,
        ROUND(_take * ((_item->>'subtotal')::numeric / NULLIF((_item->>'liters')::numeric,0)), 2),
        COALESCE(_item->>'dispatch_type','otro')
      );

      _remaining := _remaining - _take;
    END LOOP;

    IF _remaining > 0 THEN
      RAISE EXCEPTION 'No fue posible despachar los litros solicitados';
    END IF;

    UPDATE products SET stock = GREATEST(stock - (_item->>'liters')::numeric, 0)
      WHERE id = _product_id;
  END LOOP;

  RETURN _sale_id;
END; $function$;

GRANT EXECUTE ON FUNCTION public.process_liquid_sale(uuid, text, numeric, numeric, numeric, jsonb) TO authenticated, service_role;
