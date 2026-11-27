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
import type { SortCodec } from './view-registry.types';

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

const resolved = new WeakMap<object, readonly string[]>();

/**
 * A registry's non-view params: its own list (or the default) plus its
 * `extraNonViewParams`. Cached per registry so the array keeps its identity
 * across renders and can sit in hook dependency lists.
 */
export function resolveNonViewParams(registry: {
  nonViewParams?: string[];
  extraNonViewParams?: string[];
}): readonly string[] {
  const hit = resolved.get(registry);
  if (hit) return hit;
  const base = registry.nonViewParams ?? DEFAULT_NON_VIEW_PARAMS;
  const extra = registry.extraNonViewParams ?? [];
  const value = extra.length > 0 ? Array.from(new Set([...base, ...extra])) : base;
  resolved.set(registry, value);
  return value;
}

export function parseSort(raw: string | null): ViewSort | null {
  if (!raw) return null;
  const [key, dir] = raw.split(':');
  if (!key) return null;
  return { key, dir: dir === 'asc' ? 'asc' : 'desc' };
}

/** The sort an address carries, through the page's codec when it has one. */
export function readSort(params: URLSearchParams, codec?: SortCodec): ViewSort | null {
  return codec ? codec.parse(params) : parseSort(params.get(SORT_PARAM));
}

/** Writes a sort over `params`, through the page's codec when it has one. */
export function writeSort(params: URLSearchParams, sort: ViewSort | null, codec?: SortCodec): void {
  if (codec) {
    codec.write(params, sort);
    return;
  }
  params.delete(SORT_PARAM);
  if (sort) params.set(SORT_PARAM, encodeSort(sort));
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
  sortCodec?: SortCodec,
): URLSearchParams {
  const params = new URLSearchParams();
  current.forEach((value, key) => {
    if (nonViewParams.includes(key) && !PAGING_PARAMS.includes(key)) params.append(key, value);
  });
  for (const [key, value] of filterEntries(next.query, nonViewParams)) params.append(key, value);
  writeSort(params, next.sort, sortCodec);
  return params;
}

const PAGING_PARAMS = ['page', 'offset', 'cursor'];

/** True when the address carries any filter or sort, i.e. a deep link that must win over a default view. */
export function hasViewState(
  params: URLSearchParams,
  nonViewParams: readonly string[] = DEFAULT_NON_VIEW_PARAMS,
  sortCodec?: SortCodec,
): boolean {
  const hasSort = sortCodec ? sortCodec.parse(params) !== null : params.has(SORT_PARAM);
  return hasSort || filterEntries(params, nonViewParams).length > 0;
}
