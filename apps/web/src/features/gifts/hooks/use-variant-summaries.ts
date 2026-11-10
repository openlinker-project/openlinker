/**
 * Name, SKU and picture for the variants a promotion names (#3935)
 *
 * A promotion stores internal ids. The list and the detail page show the gift
 * as a product, so this resolves one variant read per id (in parallel across ids)
 * and one product read per DISTINCT product, cached, and never blocks the rows
 * that do not need them. The two reads of one variant are sequential because the
 * variant is what carries the product id, and the products API has no batched
 * variant read, so a picked-gift list costs N variant reads plus one per product.
 *
 * @module apps/web/src/features/gifts/hooks
 */
import { useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';

export interface VariantSummary {
  name: string;
  sku: string | null;
  /** API image proxy path; render through `VariantThumbnail`. */
  imageSrc: string | null;
}

export function useVariantSummaries(variantIds: readonly string[]): ReadonlyMap<string, VariantSummary> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const unique = [...new Set(variantIds.filter((id) => id !== ''))];
  const results = useQueries({
    queries: unique.map((variantId) => ({
      queryKey: ['gifts', 'variant-summary', variantId],
      queryFn: async (): Promise<VariantSummary> => {
        const variant = await apiClient.products.getVariant(variantId);
        // fetchQuery shares one in-flight read per product, so several gift
        // variants of one product cost a single product request.
        const product = await queryClient.fetchQuery({
          queryKey: ['gifts', 'product', variant.productId],
          queryFn: () => apiClient.products.getById(variant.productId),
          staleTime: 5 * 60 * 1000,
        });
        return { name: product.name, sku: variant.sku, imageSrc: variant.imageUrls?.[0] ?? null };
      },
      staleTime: 5 * 60 * 1000,
    })),
  });
  // Keyed on CONTENT: `useQueries` hands back a new array every render, so
  // depending on `results` would rebuild the Map (and every consumer's memo)
  // each time. The serialized string only changes when a summary does, which is
  // why `unique` and `results` are deliberately absent from the deps below.
  const content = unique
    .map((id, index) => {
      const data = results[index]?.data;
      return `${id}\u0000${data?.name ?? ''}\u0000${data?.sku ?? ''}\u0000${data?.imageSrc ?? ''}`;
    })
    .join('\u0001');
  return useMemo(() => {
    const summaries = new Map<string, VariantSummary>();
    unique.forEach((id, index) => {
      const data = results[index]?.data;
      if (data !== undefined) summaries.set(id, data);
    });
    return summaries;
  }, [content]);
}
