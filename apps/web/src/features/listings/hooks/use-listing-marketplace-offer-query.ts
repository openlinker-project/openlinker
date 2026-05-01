/**
 * useListingMarketplaceOfferQuery — fetch the live marketplace offer for a
 * listing-detail page (#464).
 *
 * Powers the new "Listing details" section above the raw mapping fields.
 * Disabled when the mapping isn't of `entityType === 'Offer'` so non-offer
 * detail pages don't fire a request. Retries are off — 404 (mapping isn't
 * an offer) and 422 (adapter doesn't implement `OfferReader`) are both
 * non-transient; 5xx surfaces as the error state with a manual retry button.
 *
 * `staleTime: 30_000` mirrors the BE `Cache-Control: max-age=30`.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { MarketplaceOfferResponse } from '../api/listings.types';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ApiError } from '../../../shared/api/api-error';

export function useListingMarketplaceOfferQuery(
  mappingId: string,
  options?: { enabled?: boolean },
): UseQueryResult<MarketplaceOfferResponse, ApiError> {
  const apiClient = useApiClient();

  return useQuery<MarketplaceOfferResponse, ApiError>({
    queryKey: listingsQueryKeys.marketplaceOffer(mappingId),
    queryFn: () => apiClient.listings.getMarketplaceOffer(mappingId),
    enabled: Boolean(mappingId) && (options?.enabled ?? true),
    retry: false,
    staleTime: 30_000,
  });
}
