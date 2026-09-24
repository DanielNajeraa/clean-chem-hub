import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "test-product-images";
const URL_LIFETIME_SECONDS = 60 * 60 * 24;

type ProductImage = {
  id: string;
  image_url: string | null;
};

async function createProductImageUrl(path: string) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, URL_LIFETIME_SECONDS);

  if (error) throw error;
  return data.signedUrl;
}

export function useProductImageUrls(products: ProductImage[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const productPathsRef = useRef<Record<string, string>>({});
  const retriedRef = useRef<Set<string>>(new Set());

  const refreshImage = useCallback(async (productId: string) => {
    const path = productPathsRef.current[productId];
    if (!path || retriedRef.current.has(productId)) return;
    retriedRef.current.add(productId);

    try {
      const url = await createProductImageUrl(path);
      setUrls((current) => ({ ...current, [productId]: url }));
    } catch {
      setUrls((current) => {
        const next = { ...current };
        delete next[productId];
        return next;
      });
    }
  }, []);

  // Stable key so the effect only re-runs when ids/paths actually change,
  // not on every render (e.g. `data = []` defaults create a new array each time).
  const pathsKey = JSON.stringify(
    products
      .filter((product) => Boolean(product.image_url))
      .map((product) => [product.id, product.image_url as string]),
  );

  useEffect(() => {
    let active = true;
    const paths: Record<string, string> = Object.fromEntries(JSON.parse(pathsKey));
    productPathsRef.current = paths;
    retriedRef.current = new Set();

    if (Object.keys(paths).length === 0) {
      setUrls((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }

    Promise.all(
      Object.entries(paths).map(async ([productId, path]) => {
        try {
          return [productId, await createProductImageUrl(path)] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      setUrls(Object.fromEntries(entries.filter((entry) => entry !== null)));
    });

    return () => {
      active = false;
    };
  }, [pathsKey]);

  return { urls, refreshImage };
}