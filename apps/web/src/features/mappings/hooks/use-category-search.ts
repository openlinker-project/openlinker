/**
 * Category Search Hook (#2075)
 *
 * Whole-tree category search against the neutral destination-taxonomy
 * projection (#2074, ADR-037). The counterpart to `useAllegroCategoriesQuery`,
 * which only ever returns ONE level.
 *
 * **Neutral by design, despite the `allegro*` siblings in this folder.** The
 * route resolves its scope from the connection, so one hook serves the
 * marketplace pickers AND the shop picker. Naming it `useAllegroCategorySearch`
 * to match its neighbours would make it unusable-by-name for one of its three
 * consumers, and would re-introduce exactly the platform-named legacy that
 * epic #1937 exists to retire.
 *
 * The minimum-length gate lives HERE rather than at the call sites: an empty or
 * one-character query matches a large share of the tree, and the server would
 * reject it with a 400 anyway (`TAXONOMY_SEARCH_MIN_QUERY_LENGTH`). Owning it
 * in the hook means no picker can forget it, and none of them has to restate
 * the constant.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mappingsQueryKeys } from '../api/mappings.query-keys';
import type { CategorySearchHit } from '../api/mappings.types';

/**
 * Mirrors the backend's `TAXONOMY_SEARCH_MIN_QUERY_LENGTH` (#2074), whose own
 * comment points here. Below this a query is noise rather than a search.
 */
export const CATEGORY_SEARCH_MIN_QUERY_LENGTH = 2;

/** Well under the server's clamp of 100 — a picker list is scanned, not paged. */
export const CATEGORY_SEARCH_LIMIT = 25;

/** True when `query` is long enough to be worth sending. */
export function isSearchableCategoryQuery(query: string): boolean {
  return query.trim().length >= CATEGORY_SEARCH_MIN_QUERY_LENGTH;
}

export function useCategorySearchQuery(
  connectionId: string,
  query: string,
  enabled = true
): UseQueryResult<CategorySearchHit[]> {
  const apiClient = useApiClient();
  const trimmed = query.trim();

  return useQuery({
    queryKey: mappingsQueryKeys.categorySearch(connectionId, trimmed, CATEGORY_SEARCH_LIMIT),
    queryFn: () =>
      apiClient.mappings.searchCategories(connectionId, trimmed, CATEGORY_SEARCH_LIMIT),
    enabled: enabled && isSearchableCategoryQuery(trimmed),
    // Each debounced keystroke past the minimum is a NEW query key with no
    // cached data, so without this the whole list is replaced by the loading
    // state on every extra character — the results flicker while the operator
    // is still typing. Holding the previous hits until the next page resolves
    // keeps the list stable; correctness is unaffected because the key still
    // carries the query, so a late response can never render under a newer one.
    placeholderData: keepPreviousData,
    // Shorter than the 1 h browse cache: a search is exploratory and typically
    // issued once, so holding results for an hour buys little and risks showing
    // a stale tree right after a taxonomy sync.
    staleTime: 1000 * 60 * 5,
  });
}
