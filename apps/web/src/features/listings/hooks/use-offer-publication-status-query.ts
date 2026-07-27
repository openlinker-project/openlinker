/**
 * use-offer-publication-status-query
 *
 * Reads the persisted live publication status (#1760) of a product's offers
 * from `offer_status_snapshots`. No auto-poll — the operator refreshes on
 * demand (manual refresh action) and the steady-state sync keeps snapshots
 * current in the background.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { OfferPublicationStatusResponse } from '../api/listings.types';

const PUBLICATION_STATUS_STALE_MS = 30_000;

export function useOfferPublicationStatusQuery(
  productId: string,
  connectionId?: string,
  options?: { enabled?: boolean },
): UseQueryResult<OfferPublicationStatusResponse[]> {
  const apiClient = useApiClient();

  return useQuery<OfferPublicationStatusResponse[]>({
    queryKey: listingsQueryKeys.offerPublicationStatus(productId, connectionId),
    queryFn: () => apiClient.listings.getProductOfferStatus(productId, connectionId),
    enabled: (options?.enabled ?? true) && Boolean(productId),
    staleTime: PUBLICATION_STATUS_STALE_MS,
  });
}
