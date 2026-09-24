-- The storage policies for this bucket exist in 20260722020111, but the bucket
-- itself was created outside migrations, so local environments lacked it.
INSERT INTO storage.buckets (id, name, public)
VALUES ('test-product-images', 'test-product-images', false)
ON CONFLICT (id) DO NOTHING;
