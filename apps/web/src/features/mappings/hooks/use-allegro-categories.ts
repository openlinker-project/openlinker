/**
 * Allegro Categories Hook
 *
 * TanStack Query hook for lazy-loading Allegro category tree nodes.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mappingsQueryKeys } from '../api/mappings.query-keys';
import type { AllegroCategory } from '../api/mappings.types';

export function useAllegroCategoriesQuery(
  connectionId: string,
  parentId?: string,
  enabled = true,
): UseQueryResult<AllegroCategory[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: mappingsQueryKeys.allegroCategories(connectionId, parentId),
    queryFn: () => apiClient.mappings.getAllegroCategories(connectionId, parentId),
    enabled,
    retry: false,
    staleTime: 1000 * 60 * 60, // 1 hour — categories change infrequently
  });
}
