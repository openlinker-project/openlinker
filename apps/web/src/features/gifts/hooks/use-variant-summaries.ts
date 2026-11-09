/**
 * Name, SKU and picture for the variants a promotion names (#3935)
 *
 * A promotion stores internal ids. The list and the detail page show the gift
 * as a product, so this resolves one variant read and one product read per id,
 * cached, and never blocks the rows that do not need them.
 *
 * @module apps/web/src/features/gifts/hooks
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';

export interface VariantSummary {
  name: string;
  sku: string | null;
  /** API image proxy path; render through `VariantThumbnail`. */
  imageSrc: string | null;
}

export function useVariantSummaries(variantIds: readonly string[]): ReadonlyMap<string, VariantSummary> {
  const apiClient = useApiClient();
  const unique = [...new Set(variantIds.filter((id) => id !== ''))];
  const results = useQueries({
    queries: unique.map((variantId) => ({
      queryKey: ['gifts', 'variant-summary', variantId],
      queryFn: async (): Promise<VariantSummary> => {
        const variant = await apiClient.products.getVariant(variantId);
        const product = await apiClient.products.getById(variant.productId);
        return { name: product.name, sku: variant.sku, imageSrc: variant.imageUrls?.[0] ?? null };
      },
      staleTime: 5 * 60 * 1000,
    })),
  });
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
