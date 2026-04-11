/**
 * PrestaShop Categories Hook
 *
 * TanStack Query hook for fetching PrestaShop categories for a connection.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';

interface PrestashopCategoryRaw {
  id: string | number;
  name: string | Array<{ language: Array<{ attrs: { id: string }; value: string }> }>;
  id_parent: string | number;
  level_depth: string | number;
  active: string | number;
}

export interface PrestashopCategoryFlat {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
}

function parsePrestashopCategories(raw: PrestashopCategoryRaw[]): PrestashopCategoryFlat[] {
  return raw
    .map((cat) => {
      const id = String(cat.id);
      const parentId = String(cat.id_parent);
      const depth = Number(cat.level_depth);
      let name: string;
      if (typeof cat.name === 'string') {
        name = cat.name;
      } else if (Array.isArray(cat.name)) {
        name = cat.name[0]?.language?.[0]?.value ?? `Category ${id}`;
      } else {
        name = `Category ${id}`;
      }
      return {
        id,
        name,
        parentId: parentId === '0' ? null : parentId,
        depth,
      };
    })
    .filter((cat) => cat.depth > 0);
}

export function usePrestashopCategoriesQuery(connectionId: string): UseQueryResult<PrestashopCategoryFlat[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: ['prestashop-categories', connectionId],
    queryFn: async () => {
      const raw = await apiClient.request<PrestashopCategoryRaw[]>(
        `/connections/${connectionId}/prestashop/categories`,
      );
      return parsePrestashopCategories(raw);
    },
    retry: false,
  });
}
