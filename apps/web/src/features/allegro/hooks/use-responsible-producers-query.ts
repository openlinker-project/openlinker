import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { allegroQueryKeys } from '../api/allegro.query-keys';
import type { AllegroResponsibleProducer } from '../api/allegro.api';

/**
 * Fetches the seller's EU GPSR responsible-producer registry for the given
 * connection (#430). Backs the dropdown on the Allegro connection-edit
 * page. Disabled when `connectionId` is empty so the form can render its
 * structured inputs before the connection is fully loaded.
 */
export function useResponsibleProducersQuery(
  connectionId: string,
): UseQueryResult<AllegroResponsibleProducer[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: allegroQueryKeys.responsibleProducers(connectionId),
    queryFn: () => apiClient.allegro.listResponsibleProducers(connectionId),
    enabled: connectionId.length > 0,
  });
}
