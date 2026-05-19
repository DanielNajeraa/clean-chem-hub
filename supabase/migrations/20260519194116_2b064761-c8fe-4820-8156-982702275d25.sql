-- Normalize unit_type values
UPDATE public.products SET unit_type = 'litro' WHERE is_bulk = true OR unit_type = 'litro';
UPDATE public.products SET unit_type = 'pieza' WHERE unit_type NOT IN ('litro', 'pieza');

-- Update process_production to accept container size
DROP FUNCTION IF EXISTS public.process_production(uuid, numeric);

CREATE OR REPLACE FUNCTION public.process_production(_product_id uuid, _quantity numeric, _container_liters numeric DEFAULT 20)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  _unit_type TEXT;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'produccion')) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT formula_id, unit_type INTO _formula_id, _unit_type FROM products WHERE id = _product_id;
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

  -- Solo generar garrafones para productos tipo 'litro'
  IF _unit_type = 'litro' AND _container_liters > 0 THEN
    _full_containers := FLOOR(_quantity / _container_liters)::INT;
    _remainder := _quantity - (_full_containers * _container_liters);

    FOR _i IN 1.._full_containers LOOP
      INSERT INTO inventory_containers (product_id, production_order_id, liters_initial, liters_available, status)
      VALUES (_product_id, _order_id, _container_liters, _container_liters, 'full');
    END LOOP;

    IF _remainder > 0 THEN
      INSERT INTO inventory_containers (product_id, production_order_id, liters_initial, liters_available, status)
      VALUES (_product_id, _order_id, _remainder, _remainder, 'partial');
    END IF;
  END IF;

  RETURN _order_id;
END; $function$;