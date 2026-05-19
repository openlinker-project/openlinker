/**
 * use-resolve-category-query
 *
 * Calls the BE category-resolution endpoint (#631) for the create-offer
 * wizard's Step 2 auto-prefill (#632). Returns the resolved Allegro category
 * id and the resolution method (`auto_detect` | `category_mapping` | `manual`).
 *
 * Enabled only when both `connectionId` and `barcode` are set. `retry: false`
 * because Allegro's `/sale/products` GTIN lookup regularly returns "no match"
 * and that's a normal 200 from our BE, not a transient error.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { ResolveCategoryResponse } from '../api/listings.types';

// 10-minute window. Resolution is deterministic for a given (connectionId,
// barcode) pair — the only legitimate invalidator is an admin changing
// category mappings, which is rare. 10 min covers a wizard session and the
// usual Step 0 ↔ Step 2 navigation without re-hitting Allegro's rate-limited
// /sale/products GTIN lookup on every remount.
export const RESOLVE_CATEGORY_STALE_TIME_MS = 10 * 60 * 1000;

export function useResolveCategoryQuery(
  connectionId: string | undefined,
  barcode: string | null | undefined,
  sourceCategoryIds?: string[],
): UseQueryResult<ResolveCategoryResponse> {
  const apiClient = useApiClient();
  return useQuery<ResolveCategoryResponse>({
    queryKey: listingsQueryKeys.resolveCategory(
      connectionId ?? '',
      barcode ?? null,
      sourceCategoryIds,
    ),
    queryFn: () =>
      apiClient.listings.resolveCategory(connectionId as string, {
        barcode: barcode ?? null,
        sourceCategoryIds,
      }),
    enabled: Boolean(connectionId && barcode),
    retry: false,
    staleTime: RESOLVE_CATEGORY_STALE_TIME_MS,
  });
}
