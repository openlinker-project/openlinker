/**
 * Returns Ingestion Availability Query
 *
 * The one deployment fact an empty returns list needs in order to say something
 * true: does ANY connection's adapter declare returns ingestion?
 *
 * Resolved server-side from adapter manifests — no adapter is constructed, no
 * credential resolved, no network touched — so it is cheap enough to fetch
 * unconditionally alongside the list rather than lazily on the empty branch,
 * which would delay the answer to exactly the moment it is needed.
 *
 * @module apps/web/src/features/returns/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { ReturnIngestionAvailability } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useReturnIngestionAvailabilityQuery(): UseQueryResult<ReturnIngestionAvailability | null> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: returnsQueryKeys.ingestionAvailability(),
    queryFn: () => apiClient.returns.getIngestionAvailability(),
  });
}
