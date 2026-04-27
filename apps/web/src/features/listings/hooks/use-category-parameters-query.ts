/**
 * use-category-parameters-query
 *
 * Fetches the create-offer wizard's per-category parameter schema (#410).
 * Backend caches the upstream Allegro response for 24h via the shared
 * CachePort; the FE query keeps a 24h staleTime so repeated wizard opens
 * within a session do not re-fetch.
 *
 * Returns the unwrapped `CategoryParameter[]` — the response envelope's
 * `parameters` wrapper is unpacked here so consumers don't repeat the
 * `data?.parameters ?? []` dance.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { CategoryParameter } from '../api/listings.types';

export const CATEGORY_PARAMETERS_STALE_TIME_MS = 24 * 60 * 60 * 1000;

export function useCategoryParametersQuery(
  connectionId: string | undefined,
  categoryId: string | undefined,
): UseQueryResult<CategoryParameter[]> {
  const apiClient = useApiClient();

  return useQuery<CategoryParameter[]>({
    queryKey: listingsQueryKeys.categoryParameters(connectionId ?? '', categoryId ?? ''),
    queryFn: async () => {
      const response = await apiClient.listings.getCategoryParameters(
        connectionId as string,
        categoryId as string,
      );
      return response.parameters;
    },
    enabled: Boolean(connectionId && categoryId),
    staleTime: CATEGORY_PARAMETERS_STALE_TIME_MS,
  });
}
