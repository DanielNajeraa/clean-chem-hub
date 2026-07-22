
-- Test products (manual, no production required)
CREATE TABLE public.test_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  unit_type TEXT NOT NULL CHECK (unit_type IN ('litro','pieza')),
  image_url TEXT,
  stock NUMERIC NOT NULL DEFAULT 0,
  price_granel NUMERIC DEFAULT 0,
  price_1l NUMERIC DEFAULT 0,
  price_5l NUMERIC DEFAULT 0,
  price_20l NUMERIC DEFAULT 0,
  price_pieza NUMERIC DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_products TO authenticated;
GRANT ALL ON public.test_products TO service_role;
ALTER TABLE public.test_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read test_products" ON public.test_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage test_products" ON public.test_products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));

-- Test sales
CREATE TABLE public.test_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id),
  payment_method TEXT NOT NULL,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  amount_paid NUMERIC NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'paid',
  is_credit BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_sales TO authenticated;
GRANT ALL ON public.test_sales TO service_role;
ALTER TABLE public.test_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read test_sales" ON public.test_sales FOR SELECT TO authenticated USING (true);
CREATE POLICY "sellers manage test_sales" ON public.test_sales FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));

CREATE TABLE public.test_sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.test_sales(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.test_products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  presentation TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit_price NUMERIC NOT NULL,
  subtotal NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_sale_items TO authenticated;
GRANT ALL ON public.test_sale_items TO service_role;
ALTER TABLE public.test_sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read test_sale_items" ON public.test_sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "sellers manage test_sale_items" ON public.test_sale_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'vendedor'));

-- Storage policies for test-product-images bucket
CREATE POLICY "auth read test product images" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'test-product-images');
CREATE POLICY "auth upload test product images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'test-product-images');
CREATE POLICY "auth update test product images" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'test-product-images');
CREATE POLICY "auth delete test product images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'test-product-images');
