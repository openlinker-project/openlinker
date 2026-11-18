/**
 * useViewUrlState
 *
 * The URL is the single source of the current list state. This hook reads the
 * part a view stands for (filters, sort, which view is active) and writes it
 * back; applying a view is just a write. It never touches search text or
 * paging beyond restarting the latter when the result set changes.
 *
 * @module apps/web/src/features/saved-views/hooks
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ViewSort } from '../lib/saved-view.types';
import {
  applyQueryToParams,
  canonicalQuery,
  DEFAULT_NON_VIEW_PARAMS,
  encodeSort,
  hasViewState,
  parseSort,
  SORT_PARAM,
  VIEW_PARAM,
} from '../lib/view-query';

export interface ViewUrlState {
  /** Canonical filter query of the address. */
  query: string;
  /** The sort in the address, `null` when it carries none. */
  sort: ViewSort | null;
  /** The `view` param, `null` when absent. */
  viewId: string | null;
  /** The address carries a filter or a sort, so it is a deep link that beats a default view. */
  hasState: boolean;
  /** Writes a view's filters and sort (and which view is active) over the address. */
  apply: (state: { query: string; sort: ViewSort | null }, viewId: string | null, options?: { replace?: boolean }) => void;
  setSort: (sort: ViewSort) => void;
  /** Replaces the filter query, keeping sort, the active view and everything else. */
  setQuery: (query: string) => void;
}

export function useViewUrlState(nonViewParams: readonly string[] = DEFAULT_NON_VIEW_PARAMS): ViewUrlState {
  const [params, setParams] = useSearchParams();
  const serialized = params.toString();

  const derived = useMemo(() => {
    const current = new URLSearchParams(serialized);
    return {
      query: canonicalQuery(current, nonViewParams),
      sort: parseSort(current.get(SORT_PARAM)),
      viewId: current.get(VIEW_PARAM),
      hasState: hasViewState(current, nonViewParams),
    };
  }, [serialized, nonViewParams]);

  const apply = useCallback<ViewUrlState['apply']>(
    (state, viewId, options) => {
      setParams(
        (previous) => {
          const next = applyQueryToParams(previous, state, nonViewParams);
          if (viewId) next.set(VIEW_PARAM, viewId);
          else next.delete(VIEW_PARAM);
          return next;
        },
        { replace: options?.replace ?? false },
      );
    },
    [nonViewParams, setParams],
  );

  const setSort = useCallback(
    (sort: ViewSort) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set(SORT_PARAM, encodeSort(sort));
          next.delete('page');
          next.delete('offset');
          next.delete('cursor');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setQuery = useCallback(
    (query: string) => {
      setParams(
        (previous) => {
          const sort = parseSort(previous.get(SORT_PARAM));
          const next = applyQueryToParams(previous, { query, sort }, nonViewParams);
          const viewId = previous.get(VIEW_PARAM);
          if (viewId) next.set(VIEW_PARAM, viewId);
          return next;
        },
        { replace: true },
      );
    },
    [nonViewParams, setParams],
  );

  return { ...derived, apply, setSort, setQuery };
}
