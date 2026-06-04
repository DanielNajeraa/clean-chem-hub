
-- 1. Sales: add credit/payment tracking
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS is_credit boolean NOT NULL DEFAULT false;

-- Backfill existing sales
UPDATE public.sales SET amount_paid = total, payment_status = 'paid' WHERE amount_paid = 0 AND payment_status = 'paid';

-- 2. Cash sessions
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_amount numeric NOT NULL DEFAULT 0,
  closed_at timestamptz,
  expected_cash numeric,
  counted_cash numeric,
  difference numeric,
  notes text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.cash_sessions TO authenticated;
GRANT ALL ON public.cash_sessions TO service_role;
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cs read" ON public.cash_sessions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR user_id = auth.uid());
CREATE POLICY "cs insert" ON public.cash_sessions FOR INSERT TO authenticated
  WITH CHECK ((public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) AND user_id = auth.uid());
CREATE POLICY "cs update" ON public.cash_sessions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR user_id = auth.uid())
  WITH CHECK (public.has_role(auth.uid(),'admin') OR user_id = auth.uid());

-- 3. Cash movements
CREATE TABLE IF NOT EXISTS public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE CASCADE,
  movement_type text NOT NULL, -- opening|sale|withdrawal|vale|deposit|credit_payment|closing
  amount numeric NOT NULL,
  reason text,
  beneficiary_user_id uuid,
  sale_id uuid,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.cash_movements TO authenticated;
GRANT ALL ON public.cash_movements TO service_role;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cm read" ON public.cash_movements FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR user_id = auth.uid());
CREATE POLICY "cm insert" ON public.cash_movements FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));

-- 4. Credit payments (abonos)
CREATE TABLE IF NOT EXISTS public.credit_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  payment_method text NOT NULL DEFAULT 'efectivo',
  user_id uuid NOT NULL,
  session_id uuid REFERENCES public.cash_sessions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.credit_payments TO authenticated;
GRANT ALL ON public.credit_payments TO service_role;
ALTER TABLE public.credit_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cp read" ON public.credit_payments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));
CREATE POLICY "cp insert" ON public.credit_payments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));

-- 5. Helper to update sale_credit status & maybe register cash mov on credit/cash sale
CREATE OR REPLACE FUNCTION public._finalize_sale_payment(_sale_id uuid, _payment_method text, _total numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid;
BEGIN
  IF _payment_method = 'credito' THEN
    UPDATE public.sales SET amount_paid = 0, payment_status = 'pending', is_credit = true WHERE id = _sale_id;
  ELSE
    UPDATE public.sales SET amount_paid = _total, payment_status = 'paid', is_credit = false WHERE id = _sale_id;
    IF _payment_method = 'efectivo' THEN
      SELECT id INTO _sid FROM public.cash_sessions WHERE user_id = auth.uid() AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
      IF _sid IS NOT NULL THEN
        INSERT INTO public.cash_movements(session_id, movement_type, amount, reason, sale_id, user_id)
        VALUES (_sid, 'sale', _total, 'Venta #' || substring(_sale_id::text,1,8), _sale_id, auth.uid());
      END IF;
    END IF;
  END IF;
END $$;

-- 6. Patch existing sale RPCs to call finalize
CREATE OR REPLACE FUNCTION public.process_sale(_customer_id uuid, _payment_method text, _subtotal numeric, _discount numeric, _total numeric, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sale_id UUID; _item JSONB; _current_stock NUMERIC;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT stock INTO _current_stock FROM products WHERE id = (_item->>'product_id')::UUID FOR UPDATE;
    IF _current_stock < (_item->>'quantity')::NUMERIC THEN
      RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, solicitado: %)', _item->>'product_name', _current_stock, _item->>'quantity';
    END IF;
  END LOOP;
  INSERT INTO sales (customer_id, user_id, payment_method, subtotal, discount, total)
  VALUES (_customer_id, auth.uid(), _payment_method, _subtotal, _discount, _total) RETURNING id INTO _sale_id;
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal)
    VALUES (_sale_id, (_item->>'product_id')::UUID, _item->>'product_name',
            (_item->>'quantity')::NUMERIC, (_item->>'unit_price')::NUMERIC, (_item->>'subtotal')::NUMERIC);
    UPDATE products SET stock = stock - (_item->>'quantity')::NUMERIC WHERE id = (_item->>'product_id')::UUID;
  END LOOP;
  PERFORM public._finalize_sale_payment(_sale_id, _payment_method, _total);
  RETURN _sale_id;
END $$;

CREATE OR REPLACE FUNCTION public.process_liquid_sale(_customer_id uuid, _payment_method text, _subtotal numeric, _discount numeric, _total numeric, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sale_id UUID; _item JSONB; _product_id UUID; _liters NUMERIC; _available NUMERIC; _product_name TEXT;
  _container RECORD; _remaining NUMERIC; _take NUMERIC; _new_status TEXT;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  FOR _item IN
    SELECT jsonb_build_object('product_id', product_id, 'liters', SUM(liters)) AS j
    FROM jsonb_to_recordset(_items) AS x(product_id uuid, liters numeric) GROUP BY product_id
  LOOP
    _product_id := (_item->>'product_id')::uuid; _liters := (_item->>'liters')::numeric;
    SELECT COALESCE(SUM(liters_available),0), MAX(name) INTO _available, _product_name
    FROM inventory_containers ic JOIN products p ON p.id = ic.product_id
    WHERE ic.product_id = _product_id AND ic.status <> 'empty';
    IF _available < _liters THEN RAISE EXCEPTION 'Stock insuficiente para % (disponible: % L, solicitado: % L)', COALESCE(_product_name,'producto'), _available, _liters; END IF;
  END LOOP;
  INSERT INTO sales (customer_id, user_id, payment_method, subtotal, discount, total)
  VALUES (_customer_id, auth.uid(), _payment_method, _subtotal, _discount, _total) RETURNING id INTO _sale_id;
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _product_id := (_item->>'product_id')::uuid; _remaining := (_item->>'liters')::numeric;
    FOR _container IN SELECT id, liters_available, liters_initial FROM inventory_containers
      WHERE product_id = _product_id AND status <> 'empty' ORDER BY filled_at ASC, id ASC FOR UPDATE LOOP
      EXIT WHEN _remaining <= 0;
      _take := LEAST(_remaining, _container.liters_available);
      IF (_container.liters_available - _take) <= 0 THEN _new_status := 'empty';
      ELSIF (_container.liters_available - _take) < _container.liters_initial THEN _new_status := 'partial';
      ELSE _new_status := 'full'; END IF;
      UPDATE inventory_containers SET liters_available = liters_available - _take, status = _new_status WHERE id = _container.id;
      INSERT INTO sale_container_items (sale_id, presentation_id, container_id, product_id, liters_dispatched, unit_price, subtotal, dispatch_type)
      VALUES (_sale_id, NULLIF(_item->>'presentation_id','')::uuid, _container.id, _product_id, _take,
        (_item->>'unit_price')::numeric,
        ROUND(_take * ((_item->>'subtotal')::numeric / NULLIF((_item->>'liters')::numeric,0)), 2),
        COALESCE(_item->>'dispatch_type','otro'));
      _remaining := _remaining - _take;
    END LOOP;
    IF _remaining > 0 THEN RAISE EXCEPTION 'No fue posible despachar los litros solicitados'; END IF;
    UPDATE products SET stock = GREATEST(stock - (_item->>'liters')::numeric, 0) WHERE id = _product_id;
  END LOOP;
  PERFORM public._finalize_sale_payment(_sale_id, _payment_method, _total);
  RETURN _sale_id;
END $$;

CREATE OR REPLACE FUNCTION public.process_raw_material_sale(_customer_id uuid, _payment_method text, _subtotal numeric, _discount numeric, _total numeric, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sale_id uuid; _item jsonb; _rm RECORD; _qty numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO _rm FROM raw_materials WHERE id = (_item->>'raw_material_id')::uuid FOR UPDATE;
    IF _rm IS NULL THEN RAISE EXCEPTION 'Materia prima no encontrada'; END IF;
    IF NOT _rm.is_sellable THEN RAISE EXCEPTION '% no está marcada como vendible', _rm.name; END IF;
    _qty := (_item->>'quantity')::numeric;
    IF _rm.stock < _qty THEN RAISE EXCEPTION 'Stock insuficiente para % (disponible %, solicitado %)', _rm.name, _rm.stock, _qty; END IF;
  END LOOP;
  INSERT INTO sales (customer_id, user_id, payment_method, subtotal, discount, total)
  VALUES (_customer_id, auth.uid(), _payment_method, _subtotal, _discount, _total) RETURNING id INTO _sale_id;
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::numeric;
    INSERT INTO sale_items (sale_id, raw_material_id, product_name, quantity, unit_price, subtotal, item_type)
    VALUES (_sale_id, (_item->>'raw_material_id')::uuid, _item->>'product_name', _qty,
            (_item->>'unit_price')::numeric, (_item->>'subtotal')::numeric, 'raw_material');
    UPDATE raw_materials SET stock = stock - _qty WHERE id = (_item->>'raw_material_id')::uuid;
    INSERT INTO inventory_movements (raw_material_id, movement_type, quantity, reason, user_id)
    VALUES ((_item->>'raw_material_id')::uuid, 'out', _qty, 'Venta MP #' || substring(_sale_id::text,1,8), auth.uid());
  END LOOP;
  PERFORM public._finalize_sale_payment(_sale_id, _payment_method, _total);
  RETURN _sale_id;
END $$;

-- Promotion sale: also finalize
CREATE OR REPLACE FUNCTION public.process_promotion_sale(_promotion_id uuid, _customer_id uuid, _payment_method text, _quantity integer DEFAULT 1)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _promo RECORD; _sale_id uuid; _it RECORD; _needed numeric; _container RECORD; _remaining numeric; _take numeric; _new_status text; _unit_price numeric; _today date := current_date;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT * INTO _promo FROM promotions WHERE id = _promotion_id;
  IF _promo IS NULL THEN RAISE EXCEPTION 'Promoción no encontrada'; END IF;
  IF NOT _promo.active THEN RAISE EXCEPTION 'Promoción inactiva'; END IF;
  IF _promo.start_date IS NOT NULL AND _today < _promo.start_date THEN RAISE EXCEPTION 'Promoción aún no vigente'; END IF;
  IF _promo.end_date IS NOT NULL AND _today > _promo.end_date THEN RAISE EXCEPTION 'Promoción expirada'; END IF;
  IF _quantity <= 0 THEN _quantity := 1; END IF;
  FOR _it IN SELECT pi.product_id, pi.quantity, pi.unit_type, p.name, p.stock
             FROM promotion_items pi JOIN products p ON p.id = pi.product_id WHERE pi.promotion_id = _promotion_id LOOP
    _needed := _it.quantity * _quantity;
    IF _it.unit_type = 'pieza' THEN
      IF _it.stock < _needed THEN RAISE EXCEPTION 'Stock insuficiente para % (% requeridas, % disponibles)', _it.name, _needed, _it.stock; END IF;
    ELSE
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
  FOR _it IN SELECT pi.product_id, pi.quantity, pi.unit_type, p.name, p.price AS retail_price
             FROM promotion_items pi JOIN products p ON p.id = pi.product_id WHERE pi.promotion_id = _promotion_id LOOP
    _needed := _it.quantity * _quantity; _unit_price := _it.retail_price;
    IF _it.unit_type = 'pieza' THEN
      INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal, item_type)
      VALUES (_sale_id, _it.product_id, _it.name || ' (promo)', _needed, _unit_price, _needed * _unit_price, 'product');
      UPDATE products SET stock = stock - _needed WHERE id = _it.product_id;
    ELSE
      _remaining := _needed;
      FOR _container IN SELECT id, liters_available, liters_initial FROM inventory_containers
                        WHERE product_id = _it.product_id AND status <> 'empty' ORDER BY filled_at ASC, id ASC FOR UPDATE LOOP
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
  PERFORM public._finalize_sale_payment(_sale_id, _payment_method, _promo.price * _quantity);
  RETURN _sale_id;
END $$;

-- 7. Cash session RPCs
CREATE OR REPLACE FUNCTION public.open_cash_session(_opening numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _existing uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT id INTO _existing FROM cash_sessions WHERE user_id = auth.uid() AND status = 'open' LIMIT 1;
  IF _existing IS NOT NULL THEN RAISE EXCEPTION 'Ya tienes una caja abierta'; END IF;
  INSERT INTO cash_sessions(user_id, opening_amount) VALUES (auth.uid(), _opening) RETURNING id INTO _id;
  INSERT INTO cash_movements(session_id, movement_type, amount, reason, user_id)
  VALUES (_id, 'opening', _opening, 'Fondo de apertura', auth.uid());
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.register_cash_withdrawal(_amount numeric, _reason text, _movement_type text DEFAULT 'withdrawal', _beneficiary_user_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid; _id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Monto inválido'; END IF;
  SELECT id INTO _sid FROM cash_sessions WHERE user_id = auth.uid() AND status = 'open' LIMIT 1;
  IF _sid IS NULL THEN RAISE EXCEPTION 'No hay caja abierta'; END IF;
  INSERT INTO cash_movements(session_id, movement_type, amount, reason, beneficiary_user_id, user_id)
  VALUES (_sid, _movement_type, _amount, _reason, _beneficiary_user_id, auth.uid()) RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.register_credit_payment(_sale_id uuid, _amount numeric, _payment_method text DEFAULT 'efectivo')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sale RECORD; _new_paid numeric; _sid uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT * INTO _sale FROM sales WHERE id = _sale_id FOR UPDATE;
  IF _sale IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Monto inválido'; END IF;
  _new_paid := COALESCE(_sale.amount_paid,0) + _amount;
  IF _new_paid > _sale.total + 0.01 THEN RAISE EXCEPTION 'El abono excede el total de la venta'; END IF;
  SELECT id INTO _sid FROM cash_sessions WHERE user_id = auth.uid() AND status = 'open' AND _payment_method = 'efectivo' LIMIT 1;
  INSERT INTO credit_payments(sale_id, amount, payment_method, user_id, session_id)
  VALUES (_sale_id, _amount, _payment_method, auth.uid(), _sid);
  UPDATE sales SET amount_paid = _new_paid,
    payment_status = CASE WHEN _new_paid >= total - 0.01 THEN 'paid' ELSE 'partial' END
    WHERE id = _sale_id;
  IF _sid IS NOT NULL THEN
    INSERT INTO cash_movements(session_id, movement_type, amount, reason, sale_id, user_id)
    VALUES (_sid, 'credit_payment', _amount, 'Abono venta #' || substring(_sale_id::text,1,8), _sale_id, auth.uid());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.close_cash_session(_counted numeric, _notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid; _expected numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT id INTO _sid FROM cash_sessions WHERE user_id = auth.uid() AND status = 'open' LIMIT 1;
  IF _sid IS NULL THEN RAISE EXCEPTION 'No hay caja abierta'; END IF;
  SELECT COALESCE(SUM(CASE WHEN movement_type IN ('opening','sale','credit_payment','deposit') THEN amount
                           WHEN movement_type IN ('withdrawal','vale') THEN -amount ELSE 0 END),0)
    INTO _expected FROM cash_movements WHERE session_id = _sid;
  UPDATE cash_sessions SET status='closed', closed_at=now(), counted_cash=_counted,
    expected_cash=_expected, difference=_counted - _expected, notes=_notes WHERE id = _sid;
  INSERT INTO cash_movements(session_id, movement_type, amount, reason, user_id)
  VALUES (_sid, 'closing', _counted, 'Corte de caja', auth.uid());
  RETURN _sid;
END $$;
