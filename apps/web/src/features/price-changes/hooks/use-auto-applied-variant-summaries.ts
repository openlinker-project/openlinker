import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ProductVariantSummary } from '../../products';

/**
 * Batches variant-summary lookups for the auto-applied dialog (#3151).
 *
 * `PriceChangeAutoAppliedItem` (#3145) carries only `productVariantId` — no
 * product name — so the dialog resolves a display name/SKU per row itself
 * rather than blocking #3145 on a wider log-entry contract for a
 * deliberately minimal, non-paginated surface (ADR-072 decision 3). A
 * variant fetch failing degrades to the bare id (see `auto-applied-dialog`),
 * never blocks the dialog.
 */
export function useAutoAppliedVariantSummaries(
  variantIds: readonly string[],
): UseQueryResult<ProductVariantSummary>[] {
  const apiClient = useApiClient();

  return useQueries({
    queries: variantIds.map((variantId) => ({
      queryKey: ['products', 'variant', variantId] as const,
      queryFn: () => apiClient.products.getVariant(variantId),
      retry: false,
      staleTime: 60_000,
    })),
  });
}
