/**
 * use-category-path-query
 *
 * Resolves a marketplace category id to its breadcrumb path (#1752), root ->
 * leaf, so the listing-detail drawer can render "Root > ... > Leaf" instead of
 * the raw id Allegro's offer payload carries. Backend sets a 24h Cache-Control;
 * the FE keeps a matching staleTime since category taxonomy is effectively
 * immutable.
 *
 * `retry: false` — a 404/422 (unknown category / adapter without
 * `CategoryPathReader`) is a soft fallback to the raw id, not worth retrying.
 *
 * Returns the unwrapped `CategoryPathSegment[]` — the response envelope's
 * `path` wrapper is unpacked here.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { CategoryPathSegment } from '../api/listings.types';

export const CATEGORY_PATH_STALE_TIME_MS = 24 * 60 * 60 * 1000;

export function useCategoryPathQuery(
  connectionId: string | undefined,
  categoryId: string | undefined,
  options?: { enabled?: boolean },
): UseQueryResult<CategoryPathSegment[]> {
  const apiClient = useApiClient();
  const enabled = (options?.enabled ?? true) && Boolean(connectionId && categoryId);

  return useQuery<CategoryPathSegment[]>({
    queryKey: listingsQueryKeys.categoryPath(connectionId ?? '', categoryId ?? ''),
    queryFn: async () => {
      const response = await apiClient.listings.getCategoryPath(
        connectionId as string,
        categoryId as string,
      );
      return response.path;
    },
    enabled,
    retry: false,
    staleTime: CATEGORY_PATH_STALE_TIME_MS,
  });
}
