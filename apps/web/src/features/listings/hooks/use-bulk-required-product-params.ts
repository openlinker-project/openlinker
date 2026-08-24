/**
 * use-bulk-required-product-params (#810, #2243)
 *
 * Fans the per-category parameter schema query out over the distinct set of
 * categories the bulk wizard will submit under, and returns three things:
 *
 *  - `schemaByCategory` — the full `CategoryParameter[]` per category. It was
 *    always fetched and then projected away; the value-level checks (#2243) need
 *    the declared bounds, not just which ids are required.
 *  - `requiredByCategory` — the required, unconditional, product-section
 *    parameter ids, which `computeBlockers` feeds into the
 *    `needs-product-parameters` blocker (#810).
 *  - `failedCategoryIds` — categories whose schema could NOT be fetched. Before
 *    this the hook reported only `isLoading`, so a failed query left `isLoading`
 *    false with the map key absent, which the wizard reads as "do not block":
 *    the required-parameter blocker vanished and nothing told the operator. A
 *    missing schema is now a state, not a silence.
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
  /**
   * category id → the category's full parameter schema, for the value-level
   * checks. Absent key = not loaded (or failed); no bound can be checked then.
   */
  schemaByCategory: Map<string, readonly CategoryParameter[]>;
  /** Categories whose schema fetch failed - the operator is told, not misled. */
  failedCategoryIds: readonly string[];
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

  // Built fresh each render — no memoisation. The only consumer (the wizard's
  // schema-reconcile effect) short-circuits when the recomputed blocker set is
  // unchanged, so a new `Map` identity per render can't cause a re-render loop.
  const requiredByCategory = new Map<string, readonly string[]>();
  const schemaByCategory = new Map<string, readonly CategoryParameter[]>();
  const failedCategoryIds: string[] = [];
  distinctIds.forEach((categoryId, i) => {
    const result = results[i];
    const data = result?.data;
    if (!data) {
      // `isError` and not loading is the case that used to disappear: the query
      // settled, there is no schema, and every schema-derived check is blind.
      if (result?.isError === true) failedCategoryIds.push(categoryId);
      return;
    }
    schemaByCategory.set(categoryId, data);
    requiredByCategory.set(
      categoryId,
      data.filter((p) => p.required && p.section === 'product' && !p.dependsOn).map((p) => p.id),
    );
  });

  return { requiredByCategory, schemaByCategory, failedCategoryIds, isResolving };
}
