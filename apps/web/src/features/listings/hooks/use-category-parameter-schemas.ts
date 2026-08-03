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
 * An absent map key is deliberately ambiguous, so a FAILED category is reported
 * separately (`failedCategoryIds` + `retryCategory`): "still loading" resolves
 * itself, "the request errored" never does, and a caller that blocks on an
 * unresolved schema must be able to tell the operator which one they are in.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useCallback, useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
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
  /**
   * Categories whose schema request failed and will not arrive on its own. An id
   * absent from BOTH this set and `schemasByCategory` is still in flight.
   */
  failedCategoryIds: Set<string>;
  /** Re-runs one failed category's query - the operator-facing "Retry". */
  retryCategory: (categoryId: string) => void;
}

export function useCategoryParameterSchemas(
  connectionId: string | undefined,
  categoryIds: readonly string[],
): CategoryParameterSchemas {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  // Distinct + stable order so the useQueries array stays index-aligned across
  // renders that don't change the set.
  const distinctIds = useMemo(
    () => Array.from(new Set(categoryIds.filter((id) => id.length > 0))).sort(),
    [categoryIds],
  );

  // `combine` derives the map/set inside the observer's own memoization, so both
  // keep their identity while the underlying results are unchanged - a bare
  // `new Map()` per render would defeat every `useCallback` the caller wraps
  // around it (and, transitively, its save handler). The observer compares the
  // combine function BY IDENTITY, so it has to be stable too: an inline arrow
  // recomputes on every render and buys nothing.
  const combine = useCallback(
    (
      results: readonly { data?: CategoryParameter[]; isError: boolean }[],
    ): Omit<CategoryParameterSchemas, 'retryCategory'> => {
      const schemasByCategory = new Map<string, CategoryParameter[]>();
      const failedCategoryIds = new Set<string>();
      distinctIds.forEach((categoryId, i) => {
        const result = results[i];
        if (result === undefined) return;
        if (result.data !== undefined) {
          schemasByCategory.set(categoryId, result.data);
          return;
        }
        if (result.isError) failedCategoryIds.add(categoryId);
      });
      return { schemasByCategory, failedCategoryIds };
    },
    [distinctIds],
  );

  const { schemasByCategory, failedCategoryIds } = useQueries({
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
    combine,
  });

  const retryCategory = useCallback(
    (categoryId: string): void => {
      if (connectionId === undefined || categoryId.length === 0) return;
      void queryClient.refetchQueries({
        queryKey: listingsQueryKeys.categoryParameters(connectionId, categoryId),
      });
    },
    [queryClient, connectionId],
  );

  return { schemasByCategory, failedCategoryIds, retryCategory };
}
