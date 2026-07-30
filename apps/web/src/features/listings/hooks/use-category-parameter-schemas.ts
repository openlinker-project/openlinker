/**
 * use-category-parameter-schemas (#1946)
 *
 * Fans the per-category parameter schema query out over a set of category ids
 * and returns the FULL schema per category. The bulk edit modal needs this for
 * the siblings that carry their own category (#1930): a variant's parameters
 * must be serialized against the schema that rendered its fields, and the save
 * path lives in the parent component while the variant panel is mounted only
 * for the currently open accordion scope.
 *
 * Reuses the same query key + queryFn + staleTime as
 * `useCategoryParametersQuery`, so a category already opened in the editor is a
 * cache hit and several siblings sharing one category fetch it once. Unlike
 * `use-bulk-required-product-params`, which projects each schema down to the
 * required product-section ids, this hook keeps the schema intact - the
 * serializer needs every parameter, including the hidden EAN/GTIN slot.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { CategoryParameter } from '../api/listings.types';
import { CATEGORY_PARAMETERS_STALE_TIME_MS } from './use-category-parameters-query';

export interface CategoryParameterSchemas {
  /**
   * category id → its full parameter schema. An absent key means the schema has
   * not resolved yet; callers must NOT fall back to another category's schema
   * (that is the silent-drop failure mode #1946 fixes).
   */
  schemasByCategory: Map<string, CategoryParameter[]>;
  /** True while any requested category's schema is still loading. */
  isResolving: boolean;
}

export function useCategoryParameterSchemas(
  connectionId: string | undefined,
  categoryIds: readonly string[],
): CategoryParameterSchemas {
  const apiClient = useApiClient();

  // Distinct + stable order so the useQueries array stays index-aligned across
  // renders that don't change the set.
  const distinctIds = useMemo(
    () => Array.from(new Set(categoryIds.filter((id) => id.length > 0))).sort(),
    [categoryIds],
  );

  const results = useQueries({
    queries: distinctIds.map((categoryId) => ({
      queryKey: listingsQueryKeys.categoryParameters(connectionId ?? '', categoryId),
      queryFn: async (): Promise<CategoryParameter[]> => {
        const response = await apiClient.listings.getCategoryParameters(
          connectionId as string,
          categoryId,
        );
        return response.parameters;
      },
      enabled: Boolean(connectionId) && categoryId.length > 0,
      staleTime: CATEGORY_PARAMETERS_STALE_TIME_MS,
    })),
  });

  const isResolving = results.some((q) => q.isLoading);

  const schemasByCategory = new Map<string, CategoryParameter[]>();
  distinctIds.forEach((categoryId, i) => {
    const data = results[i]?.data;
    if (!data) return;
    schemasByCategory.set(categoryId, data);
  });

  return { schemasByCategory, isResolving };
}
