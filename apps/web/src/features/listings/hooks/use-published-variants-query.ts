/**
 * use-published-variants-query (#1837)
 *
 * Destination-aware duplicate guard. Given a destination connection and a set
 * of variant ids, returns the subset already published there - an offer mapping
 * (marketplace) or a shop-product mapping (online shop). Backs the "already on
 * {destination}" flags and the soft confirm gate in the unified publish flow.
 *
 * Returns a `Set<string>` for O(1) membership checks at the call sites. The
 * query is disabled when there is no connection or no variant ids to check.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';

/** Published mappings shift rarely relative to a wizard session; 30s keeps
 *  back-and-forth navigation from re-fetching without going stale for long. */
export const PUBLISHED_VARIANTS_STALE_TIME_MS = 30 * 1000;

export function usePublishedVariantsQuery(
  connectionId: string | null,
  variantIds: readonly string[],
  enabled = true,
): UseQueryResult<Set<string>> {
  const apiClient = useApiClient();
  const active = enabled && Boolean(connectionId) && variantIds.length > 0;

  return useQuery<Set<string>>({
    queryKey: listingsQueryKeys.publishedVariants(connectionId ?? '', variantIds),
    queryFn: async () => {
      const response = await apiClient.listings.checkPublishedVariants({
        connectionId: connectionId!,
        variantIds: [...variantIds],
      });
      return new Set(response.publishedVariantIds);
    },
    enabled: active,
    staleTime: PUBLISHED_VARIANTS_STALE_TIME_MS,
  });
}
