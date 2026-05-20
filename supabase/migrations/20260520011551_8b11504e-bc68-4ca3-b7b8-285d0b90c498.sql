
ALTER TABLE public.raw_materials
  ADD COLUMN IF NOT EXISTS is_producible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS formula_id uuid NULL,
  ADD COLUMN IF NOT EXISTS is_sellable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sale_price numeric NOT NULL DEFAULT 0;

ALTER TABLE public.production_orders
  ALTER COLUMN product_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS raw_material_id uuid NULL;

ALTER TABLE public.sale_items
  ALTER COLUMN product_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS raw_material_id uuid NULL,
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'product';

-- ============ Producir materia prima ============
CREATE OR REPLACE FUNCTION public.process_raw_material_production(_raw_material_id uuid, _quantity numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _formula_id uuid;
  _order_id uuid;
  _total_cost numeric := 0;
  _item RECORD;
  _needed numeric;
  _rm_name text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion')) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT formula_id, name INTO _formula_id, _rm_name FROM raw_materials WHERE id = _raw_material_id;
  IF _formula_id IS NULL THEN RAISE EXCEPTION 'Esta materia prima no tiene fórmula asignada'; END IF;

  FOR _item IN SELECT fi.raw_material_id, fi.quantity, rm.stock, rm.cost_per_unit, rm.name
               FROM formula_items fi JOIN raw_materials rm ON rm.id = fi.raw_material_id
               WHERE fi.formula_id = _formula_id LOOP
    IF _item.raw_material_id = _raw_material_id THEN
      RAISE EXCEPTION 'La fórmula no puede contener la misma materia prima que produce (%)', _item.name;
    END IF;
    _needed := _item.quantity * _quantity;
    IF _item.stock < _needed THEN
      RAISE EXCEPTION 'Materia prima insuficiente: % (necesita %, disponible %)', _item.name, _needed, _item.stock;
    END IF;
    _total_cost := _total_cost + (_needed * _item.cost_per_unit);
  END LOOP;

  INSERT INTO production_orders (raw_material_id, quantity, total_cost, user_id)
  VALUES (_raw_material_id, _quantity, _total_cost, auth.uid())
  RETURNING id INTO _order_id;

  FOR _item IN SELECT fi.raw_material_id, fi.quantity, rm.name
               FROM formula_items fi JOIN raw_materials rm ON rm.id = fi.raw_material_id
               WHERE fi.formula_id = _formula_id LOOP
    _needed := _item.quantity * _quantity;
    UPDATE raw_materials SET stock = stock - _needed WHERE id = _item.raw_material_id;
    INSERT INTO inventory_movements (raw_material_id, movement_type, quantity, reason, user_id)
    VALUES (_item.raw_material_id, 'out', _needed, 'Producción MP #' || substring(_order_id::text,1,8), auth.uid());
  END LOOP;

  UPDATE raw_materials SET stock = stock + _quantity WHERE id = _raw_material_id;
  INSERT INTO inventory_movements (raw_material_id, movement_type, quantity, reason, user_id)
  VALUES (_raw_material_id, 'in', _quantity, 'Producción MP #' || substring(_order_id::text,1,8), auth.uid());

  RETURN _order_id;
END; $$;

-- ============ Vender materia prima ============
CREATE OR REPLACE FUNCTION public.process_raw_material_sale(
  _customer_id uuid, _payment_method text, _subtotal numeric, _discount numeric, _total numeric, _items jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sale_id uuid;
  _item jsonb;
  _rm RECORD;
  _qty numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO _rm FROM raw_materials WHERE id = (_item->>'raw_material_id')::uuid FOR UPDATE;
    IF _rm IS NULL THEN RAISE EXCEPTION 'Materia prima no encontrada'; END IF;
    IF NOT _rm.is_sellable THEN RAISE EXCEPTION '% no está marcada como vendible', _rm.name; END IF;
    _qty := (_item->>'quantity')::numeric;
    IF _rm.stock < _qty THEN
      RAISE EXCEPTION 'Stock insuficiente para % (disponible %, solicitado %)', _rm.name, _rm.stock, _qty;
    END IF;
  END LOOP;

  INSERT INTO sales (customer_id, user_id, payment_method, subtotal, discount, total)
  VALUES (_customer_id, auth.uid(), _payment_method, _subtotal, _discount, _total)
  RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::numeric;
    INSERT INTO sale_items (sale_id, raw_material_id, product_name, quantity, unit_price, subtotal, item_type)
    VALUES (_sale_id, (_item->>'raw_material_id')::uuid, _item->>'product_name', _qty,
            (_item->>'unit_price')::numeric, (_item->>'subtotal')::numeric, 'raw_material');
    UPDATE raw_materials SET stock = stock - _qty WHERE id = (_item->>'raw_material_id')::uuid;
    INSERT INTO inventory_movements (raw_material_id, movement_type, quantity, reason, user_id)
    VALUES ((_item->>'raw_material_id')::uuid, 'out', _qty, 'Venta MP #' || substring(_sale_id::text,1,8), auth.uid());
  END LOOP;

  RETURN _sale_id;
END; $$;
