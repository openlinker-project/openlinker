/**
 * PrestaShop Categories Hook
 *
 * TanStack Query hook for fetching PrestaShop categories for a connection.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { getMessages, interpolate } from '../../../shared/i18n';

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
      const categories = await apiClient.mappings.getPrestashopCategories(connectionId);
      return categories
        .filter((cat) => cat.depth > 0)
        .map(({ id, name, parentId, depth }) => ({
          id,
          name: name || interpolate(getMessages('mappings').usePrestashopCategories.fallbackName, { id }),
          parentId,
          depth,
        }));
    },
  });
}
