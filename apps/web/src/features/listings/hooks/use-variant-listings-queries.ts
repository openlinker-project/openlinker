import { useQueries } from '@tanstack/react-query';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { OfferMapping } from '../api/listings.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * The listings of several variants, one read each (the listings API filters by
 * the single variant a mapping points at). Shares the `list` cache entries with
 * `useListingsQuery`, so a variant already read elsewhere is not read twice.
 * `items` is `[]` until a variant's read resolves; `loaded` says when all have.
 */
export function useVariantListingsQueries(variantIds: readonly string[]): {
  byVariant: Map<string, OfferMapping[]>;
  loaded: boolean;
} {
  const apiClient = useApiClient();
  const results = useQueries({
    queries: variantIds.map((id) => ({
      queryKey: listingsQueryKeys.list({ internalId: id }, { limit: 50, offset: 0 }),
      queryFn: () => apiClient.listings.list({ internalId: id }, { limit: 50, offset: 0 }),
    })),
  });
  return {
    byVariant: new Map(variantIds.map((id, index) => [id, results[index]?.data?.items ?? []])),
    loaded: results.every((r) => r.isSuccess),
  };
}
