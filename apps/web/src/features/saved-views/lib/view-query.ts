/**
 * View Query
 *
 * Reads and writes the part of the URL a view stands for: the filter query and
 * the sort. Everything else in the address (search text, paging, the active
 * view id) is the moment's state and is left alone.
 *
 * @module apps/web/src/features/saved-views/lib
 */
import type { ViewSort } from './saved-view.types';

export const SORT_PARAM = 'sort';
export const VIEW_PARAM = 'view';

/** Params that belong to the moment, never to a view. */
export const DEFAULT_NON_VIEW_PARAMS: readonly string[] = [
  SORT_PARAM,
  VIEW_PARAM,
  'q',
  'search',
  'page',
  'offset',
  'cursor',
  'limit',
];

export function parseSort(raw: string | null): ViewSort | null {
  if (!raw) return null;
  const [key, dir] = raw.split(':');
  if (!key) return null;
  return { key, dir: dir === 'asc' ? 'asc' : 'desc' };
}

export function encodeSort(sort: ViewSort): string {
  return `${sort.key}:${sort.dir}`;
}

/**
 * The filter entries of a query string, with the non-view params removed and
 * empty values dropped. Sorted by key so two spellings of one filter set
 * compare equal.
 */
export function filterEntries(
  query: string | URLSearchParams,
  nonViewParams: readonly string[] = DEFAULT_NON_VIEW_PARAMS,
): Array<[string, string]> {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  const entries: Array<[string, string]> = [];
  params.forEach((value, key) => {
    if (value === '' || nonViewParams.includes(key)) return;
    entries.push([key, value]);
  });
  return entries.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
}

/** The canonical, order-independent spelling of a filter query. */
export function canonicalQuery(
  query: string | URLSearchParams,
  nonViewParams: readonly string[] = DEFAULT_NON_VIEW_PARAMS,
): string {
  return new URLSearchParams(filterEntries(query, nonViewParams)).toString();
}

/**
 * Writes a view's filters and sort over the current address. Filters of the
 * previous state are replaced, non-view params (search, paging) survive except
 * paging, which restarts because the result set changed.
 */
export function applyQueryToParams(
  current: URLSearchParams,
  next: { query: string; sort: ViewSort | null },
  nonViewParams: readonly string[] = DEFAULT_NON_VIEW_PARAMS,
): URLSearchParams {
  const params = new URLSearchParams();
  current.forEach((value, key) => {
    if (nonViewParams.includes(key) && !PAGING_PARAMS.includes(key)) params.append(key, value);
  });
  params.delete(SORT_PARAM);
  for (const [key, value] of filterEntries(next.query, nonViewParams)) params.append(key, value);
  if (next.sort) params.set(SORT_PARAM, encodeSort(next.sort));
  return params;
}

const PAGING_PARAMS = ['page', 'offset', 'cursor'];

/** True when the address carries any filter or sort, i.e. a deep link that must win over a default view. */
export function hasViewState(
  params: URLSearchParams,
  nonViewParams: readonly string[] = DEFAULT_NON_VIEW_PARAMS,
): boolean {
  return params.has(SORT_PARAM) || filterEntries(params, nonViewParams).length > 0;
}
