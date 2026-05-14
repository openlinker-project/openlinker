/**
 * useVariantQuery — fetch a single variant's summary (#464).
 *
 * Powers the listing-detail page's inline SKU+EAN enrichment next to the
 * Internal ID row. The enrichment is a nice-to-have, not load-bearing —
 * a 404 or transient error renders silently (the bare ID still shows). For
 * that reason we disable retries: a missing or transiently-failing variant
 * shouldn't keep refetching in the background.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { productsQueryKeys } from '../api/products.query-keys';
import type { ProductVariantSummary } from '../api/products.types';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';

export function useVariantQuery(
  variantId: string | undefined
): UseQueryResult<ProductVariantSummary, ApiError> {
  const apiClient = useApiClient();

  return useQuery<ProductVariantSummary, ApiError>({
    queryKey: productsQueryKeys.variant(variantId ?? ''),
    queryFn: () => apiClient.products.getVariant(variantId ?? ''),
    enabled: Boolean(variantId),
    retry: false,
    staleTime: 60_000,
  });
}
