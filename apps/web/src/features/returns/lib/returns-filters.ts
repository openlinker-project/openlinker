/**
 * Returns List Filters
 *
 * Pure read/write helpers over the `/returns` search params (#2335). Extracted
 * into the feature rather than left page-local — the orders list spells the
 * same three helpers inline, and a pure module is what makes the narrowing
 * rules testable without rendering a page.
 *
 * Two rules this module owns.
 *
 * **A raw param is narrowed by a guard, never cast.** `bucket` is validated
 * server-side with `@IsIn`, so forwarding a hand-edited junk value would 400
 * the whole page over a typo in the URL bar. An unrecognised value is dropped.
 *
 * **`offset` is paging, not a filter.** `hasActiveReturnFilters` deliberately
 * excludes it: an empty page caused by paging past the end is a different
 * operator situation from an empty page caused by a filter, and conflating the
 * two makes the list claim there are no returns when there are.
 *
 * @module apps/web/src/features/returns/lib
 */
import { isReturnBucket, type ReturnFilters } from '../api/returns.types';

/**
 * Every param this page owns. `offset` is listed so a filter change can clear
 * it, but is excluded from {@link hasActiveReturnFilters} — see the module
 * docblock.
 */
export const RETURN_FILTER_PARAMS = [
  'bucket',
  'sourceConnectionId',
  'createdFrom',
  'createdTo',
] as const;

export const RETURN_OFFSET_PARAM = 'offset';

/** Read the filters out of the URL, narrowing every raw value. */
export function readReturnFilters(params: URLSearchParams): ReturnFilters {
  const bucket = params.get('bucket');
  const sourceConnectionId = params.get('sourceConnectionId');
  const createdFrom = params.get('createdFrom');
  const createdTo = params.get('createdTo');

  return {
    bucket: isReturnBucket(bucket) ? bucket : undefined,
    sourceConnectionId: sourceConnectionId ?? undefined,
    createdFrom: createdFrom ?? undefined,
    createdTo: createdTo ?? undefined,
  };
}

/**
 * Read the page offset. A negative, non-numeric or absent value reads as 0 —
 * the list's first page is always reachable, whatever is in the URL.
 */
export function readReturnOffset(params: URLSearchParams): number {
  const raw = Number(params.get(RETURN_OFFSET_PARAM) ?? '0');
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

/**
 * Whether any FILTER is narrowing the list.
 *
 * Reads the narrowed filters, not the raw params, so an unrecognised `bucket`
 * that this module already dropped does not make an unfiltered list claim to be
 * filtered — which would send an empty page to the "no matches" branch and hide
 * the fact that the deployment has no returns at all.
 */
export function hasActiveReturnFilters(filters: ReturnFilters): boolean {
  return (
    filters.bucket !== undefined ||
    filters.sourceConnectionId !== undefined ||
    filters.createdFrom !== undefined ||
    filters.createdTo !== undefined
  );
}

/**
 * Set (or clear, on an empty value) one filter param.
 *
 * Always clears `offset`: the row at offset 40 of the unfiltered list is not
 * the row at offset 40 of the filtered one, so keeping the offset lands the
 * operator on an arbitrary page — usually an empty one.
 */
export function setReturnFilterParam(
  params: URLSearchParams,
  key: (typeof RETURN_FILTER_PARAMS)[number],
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  next.delete(RETURN_OFFSET_PARAM);
  return next;
}

/** Drop every filter param (and the offset) in one call. */
export function clearReturnFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of RETURN_FILTER_PARAMS) next.delete(key);
  next.delete(RETURN_OFFSET_PARAM);
  return next;
}

/** Move to a page offset, dropping the param entirely at the first page. */
export function setReturnOffsetParam(params: URLSearchParams, offset: number): URLSearchParams {
  const next = new URLSearchParams(params);
  if (offset <= 0) next.delete(RETURN_OFFSET_PARAM);
  else next.set(RETURN_OFFSET_PARAM, String(offset));
  return next;
}
