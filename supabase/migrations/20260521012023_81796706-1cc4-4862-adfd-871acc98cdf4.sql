
-- Customer city/locality tag
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS city text;

-- Promotions
CREATE TABLE IF NOT EXISTS public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  start_date date,
  end_date date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "promo read all" ON public.promotions FOR SELECT TO authenticated USING (true);
CREATE POLICY "promo admin write" ON public.promotions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.promotion_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_type text NOT NULL DEFAULT 'pieza'
);
ALTER TABLE public.promotion_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pi read all" ON public.promotion_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "pi admin write" ON public.promotion_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Track promo on sale
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS promotion_id uuid;

-- RPC: process a promotion sale. Supports piece + liquid bundled products.
CREATE OR REPLACE FUNCTION public.process_promotion_sale(
  _promotion_id uuid,
  _customer_id uuid,
  _payment_method text,
  _quantity int DEFAULT 1
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _promo RECORD;
  _sale_id uuid;
  _it RECORD;
  _prod RECORD;
  _needed numeric;
  _container RECORD;
  _remaining numeric;
  _take numeric;
  _new_status text;
  _unit_price numeric;
  _today date := current_date;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT * INTO _promo FROM promotions WHERE id = _promotion_id;
  IF _promo IS NULL THEN RAISE EXCEPTION 'Promoción no encontrada'; END IF;
  IF NOT _promo.active THEN RAISE EXCEPTION 'Promoción inactiva'; END IF;
  IF _promo.start_date IS NOT NULL AND _today < _promo.start_date THEN
    RAISE EXCEPTION 'Promoción aún no vigente';
  END IF;
  IF _promo.end_date IS NOT NULL AND _today > _promo.end_date THEN
    RAISE EXCEPTION 'Promoción expirada';
  END IF;
  IF _quantity <= 0 THEN _quantity := 1; END IF;

  -- Validate stock
  FOR _it IN SELECT pi.product_id, pi.quantity, pi.unit_type, p.name, p.stock
             FROM promotion_items pi JOIN products p ON p.id = pi.product_id
             WHERE pi.promotion_id = _promotion_id LOOP
    _needed := _it.quantity * _quantity;
    IF _it.unit_type = 'pieza' THEN
      IF _it.stock < _needed THEN RAISE EXCEPTION 'Stock insuficiente para % (% requeridas, % disponibles)', _it.name, _needed, _it.stock; END IF;
    ELSE
      -- liquid: sum container liters
      DECLARE _avail numeric;
      BEGIN
        SELECT COALESCE(SUM(liters_available),0) INTO _avail FROM inventory_containers WHERE product_id = _it.product_id AND status <> 'empty';
        IF _avail < _needed THEN RAISE EXCEPTION 'Stock insuficiente líquido para % (% L req, % L disp)', _it.name, _needed, _avail; END IF;
      END;
    END IF;
  END LOOP;

  INSERT INTO sales (customer_id, user_id, payment_method, subtotal, discount, total, promotion_id)
  VALUES (_customer_id, auth.uid(), _payment_method, _promo.price * _quantity, 0, _promo.price * _quantity, _promotion_id)
  RETURNING id INTO _sale_id;

  -- Process each item; prorate price for record-keeping
  FOR _it IN SELECT pi.product_id, pi.quantity, pi.unit_type, p.name, p.price AS retail_price
             FROM promotion_items pi JOIN products p ON p.id = pi.product_id
             WHERE pi.promotion_id = _promotion_id LOOP
    _needed := _it.quantity * _quantity;
    _unit_price := _it.retail_price;
    IF _it.unit_type = 'pieza' THEN
      INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal, item_type)
      VALUES (_sale_id, _it.product_id, _it.name || ' (promo)', _needed, _unit_price, _needed * _unit_price, 'product');
      UPDATE products SET stock = stock - _needed WHERE id = _it.product_id;
    ELSE
      _remaining := _needed;
      FOR _container IN SELECT id, liters_available, liters_initial
                        FROM inventory_containers
                        WHERE product_id = _it.product_id AND status <> 'empty'
                        ORDER BY filled_at ASC, id ASC FOR UPDATE LOOP
        EXIT WHEN _remaining <= 0;
        _take := LEAST(_remaining, _container.liters_available);
        IF (_container.liters_available - _take) <= 0 THEN _new_status := 'empty';
        ELSIF (_container.liters_available - _take) < _container.liters_initial THEN _new_status := 'partial';
        ELSE _new_status := 'full'; END IF;
        UPDATE inventory_containers SET liters_available = liters_available - _take, status = _new_status WHERE id = _container.id;
        INSERT INTO sale_container_items (sale_id, container_id, product_id, liters_dispatched, unit_price, subtotal, dispatch_type)
        VALUES (_sale_id, _container.id, _it.product_id, _take, _unit_price, _take * _unit_price, 'promo');
        _remaining := _remaining - _take;
      END LOOP;
      UPDATE products SET stock = GREATEST(stock - _needed, 0) WHERE id = _it.product_id;
    END IF;
  END LOOP;

  RETURN _sale_id;
END $$;
