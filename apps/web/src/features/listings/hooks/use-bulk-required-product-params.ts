/**
 * use-bulk-required-product-params (#810)
 *
 * Fans the per-category parameter schema query out over the distinct set of
 * categories that the bulk wizard's no-card rows will submit under, and returns
 * the *required, unconditional, product-section* parameter ids per category.
 * The wizard feeds these into `computeBlockers` to raise the
 * `needs-product-parameters` blocker on rows that would 422 (no card to inherit
 * from + missing required product params).
 *
 * Reuses the same query key + queryFn + 24h staleTime as
 * `useCategoryParametersQuery`, so categories already opened in the edit modal
 * are cache hits and a batch sharing one category fetches it once.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { CategoryParameter } from '../api/listings.types';
import { CATEGORY_PARAMETERS_STALE_TIME_MS } from './use-category-parameters-query';

export interface BulkRequiredProductParams {
  /**
   * category id → required, unconditional (`!dependsOn`) product-section param
   * ids. Absent key = schema not loaded yet (caller treats as "don't block").
   */
  requiredByCategory: Map<string, readonly string[]>;
  /** True while any category's schema is still loading its first response. */
  isResolving: boolean;
}

export function useBulkRequiredProductParams(
  connectionId: string | undefined,
  categoryIds: readonly string[],
): BulkRequiredProductParams {
  const apiClient = useApiClient();

  // Distinct + stable order so the useQueries array stays index-aligned across
  // renders that don't change the set.
  const distinctIds = useMemo(
    () => Array.from(new Set(categoryIds)).sort(),
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

  // A category's schema is immutable, so this signature flips at most once per
  // category (unloaded → loaded). Memoising the return value on it keeps the
  // object identity stable when nothing changed — the consumer effect depends
  // on `requiredByCategory`, so a fresh Map every render would re-run it.
  const signature = distinctIds
    .map((id, i) => `${id}:${results[i]?.data ? '1' : '0'}`)
    .join('|');

  return useMemo<BulkRequiredProductParams>(() => {
    const requiredByCategory = new Map<string, readonly string[]>();
    distinctIds.forEach((categoryId, i) => {
      const data = results[i]?.data;
      if (!data) return;
      requiredByCategory.set(
        categoryId,
        data
          .filter((p) => p.required && p.section === 'product' && !p.dependsOn)
          .map((p) => p.id),
      );
    });
    return { requiredByCategory, isResolving };
    // `signature` captures distinctIds + each query's loaded state; `results`
    // identity changes every render so it intentionally isn't a dep.
  }, [signature, isResolving]);
}
