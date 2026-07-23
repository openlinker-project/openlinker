/**
 * Category Path Hook
 *
 * TanStack Query hook resolving a source (Allegro) category id to its
 * root-to-leaf breadcrumb (#1741). Used by the bulk-offer wizard chip to show
 * a human breadcrumb for a category auto-resolved from a variant EAN, where
 * only the raw id is known up front.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mappingsQueryKeys } from '../api/mappings.query-keys';
import type { CategoryPathNode } from '../api/mappings.types';

/** Category taxonomy is stable - mirror the resolve-category stale window. */
const CATEGORY_PATH_STALE_TIME_MS = 10 * 60 * 1000;

export function useCategoryPathQuery(
  connectionId: string,
  categoryId: string,
): UseQueryResult<CategoryPathNode[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: mappingsQueryKeys.allegroCategoryPath(connectionId, categoryId),
    queryFn: () => apiClient.mappings.getCategoryPath(connectionId, categoryId),
    enabled: connectionId.length > 0 && categoryId.length > 0,
    staleTime: CATEGORY_PATH_STALE_TIME_MS,
  });
}
