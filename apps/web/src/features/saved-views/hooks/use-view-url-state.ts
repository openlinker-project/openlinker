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
  filterEntries,
  hasViewState,
  readSort,
  VIEW_PARAM,
  writeSort,
} from '../lib/view-query';
import type { SortCodec } from '../lib/view-registry.types';

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

export interface ViewUrlStateOptions {
  /** Name of the param that carries the applied view's id. Defaults to `view`; a page that already owns `view` renames it. */
  viewParam?: string;
  /** False on a list with no sort at all: the address never carries one and a stray `sort` is not a deep link. */
  sortable?: boolean;
  /** How the address spells the sort, for a page whose URLs already carry it as something other than `sort=key:dir`. */
  sortCodec?: SortCodec;
}

export function useViewUrlState(
  nonViewParams: readonly string[] = DEFAULT_NON_VIEW_PARAMS,
  options: ViewUrlStateOptions = {},
): ViewUrlState {
  const viewParam = options.viewParam ?? VIEW_PARAM;
  const sortable = options.sortable !== false;
  const sortCodec = options.sortCodec;
  const [params, setParams] = useSearchParams();
  const serialized = params.toString();

  const derived = useMemo(() => {
    const current = new URLSearchParams(serialized);
    return {
      query: canonicalQuery(current, nonViewParams),
      sort: sortable ? readSort(current, sortCodec) : null,
      viewId: current.get(viewParam),
      hasState: sortable
        ? hasViewState(current, nonViewParams, sortCodec)
        : filterEntries(current, nonViewParams).length > 0,
    };
  }, [serialized, nonViewParams, viewParam, sortable, sortCodec]);

  const apply = useCallback<ViewUrlState['apply']>(
    (state, viewId, options) => {
      setParams(
        (previous) => {
          const next = applyQueryToParams(previous, { ...state, sort: sortable ? state.sort : null }, nonViewParams, sortCodec);
          if (viewId) next.set(viewParam, viewId);
          else next.delete(viewParam);
          return next;
        },
        { replace: options?.replace ?? false },
      );
    },
    [nonViewParams, setParams, viewParam, sortable, sortCodec],
  );

  const setSort = useCallback(
    (sort: ViewSort) => {
      if (!sortable) return;
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          writeSort(next, sort, sortCodec);
          next.delete('page');
          next.delete('offset');
          next.delete('cursor');
          return next;
        },
        { replace: true },
      );
    },
    [setParams, sortable, sortCodec],
  );

  const setQuery = useCallback(
    (query: string) => {
      setParams(
        (previous) => {
          const sort = sortable ? readSort(previous, sortCodec) : null;
          const next = applyQueryToParams(previous, { query, sort }, nonViewParams, sortCodec);
          const viewId = previous.get(viewParam);
          if (viewId) next.set(viewParam, viewId);
          return next;
        },
        { replace: true },
      );
    },
    [nonViewParams, setParams, viewParam, sortable, sortCodec],
  );

  return { ...derived, apply, setSort, setQuery };
}
