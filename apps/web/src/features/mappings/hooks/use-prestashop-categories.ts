/**
 * PrestaShop Categories Hook
 *
 * TanStack Query hook for fetching PrestaShop categories for a connection.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';

interface PrestashopCategoryApi {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  active: boolean;
}

export interface PrestashopCategoryFlat {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
}

export function usePrestashopCategoriesQuery(connectionId: string): UseQueryResult<PrestashopCategoryFlat[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: ['prestashop-categories', connectionId],
    queryFn: async () => {
      const raw = await apiClient.request<PrestashopCategoryApi[]>(
        `/connections/${connectionId}/prestashop/categories`,
      );
      return raw
        .map(({ id, name, parentId, depth }) => ({
          id: String(id),
          name: name || `Category ${id}`,
          parentId: parentId ?? null,
          depth: Number(depth),
        }))
        .filter((cat) => cat.depth > 0);
    },
    retry: false,
  });
}
