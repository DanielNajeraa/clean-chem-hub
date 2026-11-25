-- Historial de abonos para las ventas a crédito del POS de prueba.
-- Antes cada abono solo sumaba a test_sales.amount_paid y no quedaba registro individual.

CREATE TABLE IF NOT EXISTS public.test_credit_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.test_sales(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'efectivo',
  notes TEXT,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS test_credit_payments_sale_id_idx ON public.test_credit_payments(sale_id);

-- Solo lectura directa: los abonos se registran con register_test_credit_payment,
-- que actualiza la venta y el historial juntos para que nunca queden desfasados.
GRANT SELECT ON public.test_credit_payments TO authenticated;
GRANT ALL ON public.test_credit_payments TO service_role;
ALTER TABLE public.test_credit_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read test_credit_payments" ON public.test_credit_payments;
CREATE POLICY "auth read test_credit_payments" ON public.test_credit_payments
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.register_test_credit_payment(
  _sale_id UUID, _amount NUMERIC, _payment_method TEXT DEFAULT 'efectivo', _notes TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sale RECORD; _new_paid NUMERIC; _id UUID;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor')) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  SELECT * INTO _sale FROM test_sales WHERE id = _sale_id FOR UPDATE;
  IF _sale IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF NOT _sale.is_credit THEN RAISE EXCEPTION 'La venta no es a crédito'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Monto inválido'; END IF;
  _new_paid := COALESCE(_sale.amount_paid, 0) + _amount;
  IF _new_paid > _sale.total + 0.01 THEN
    RAISE EXCEPTION 'El abono excede el saldo (saldo: %)', round(_sale.total - COALESCE(_sale.amount_paid, 0), 2);
  END IF;

  INSERT INTO test_credit_payments(sale_id, amount, payment_method, notes, user_id)
  VALUES (_sale_id, _amount, COALESCE(NULLIF(_payment_method, ''), 'efectivo'), NULLIF(trim(_notes), ''), auth.uid())
  RETURNING id INTO _id;

  UPDATE test_sales SET
    amount_paid = LEAST(_new_paid, total),
    payment_status = CASE WHEN _new_paid >= total - 0.01 THEN 'paid' ELSE 'partial' END,
    updated_at = now()
  WHERE id = _sale_id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.register_test_credit_payment(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_test_credit_payment(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

-- Las ventas que ya tenían abonos antes de este cambio no tienen detalle; se registra
-- un solo renglón con lo acumulado para que el historial cuadre con lo pagado.
INSERT INTO public.test_credit_payments (sale_id, amount, payment_method, notes, user_id, created_at)
SELECT s.id, s.amount_paid, 'sin_detalle', 'Abonos registrados antes del historial', NULL, s.updated_at
FROM public.test_sales s
WHERE s.is_credit AND s.amount_paid > 0
  AND NOT EXISTS (SELECT 1 FROM public.test_credit_payments p WHERE p.sale_id = s.id);
