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
import {
  isReturnBucket,
  isReturnLineReason,
  isReturnMoneyState,
  type ReturnFilters,
} from '../api/returns.types';
import { isReturnSegment } from './return-segments';
import { isReturnStage } from './return-stage.types';

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
  // #2378. `attention` and `orphan` are deliberately ABSENT: spec § 4.3 names
  // them, but they are SEGMENTS, not value filters, and two spellings of one
  // filter is drift by construction. Three of § 4.3's own six segments span two
  // states each, so no single-valued param can name them — hence one `segment`
  // param with six values. Recorded here so the deviation is not reconstructed
  // from a diff later.
  'segment',
  'stage',
  'money',
  'reason',
  'openedFrom',
  'openedTo',
] as const;

export const RETURN_OFFSET_PARAM = 'offset';

/** Read the filters out of the URL, narrowing every raw value. */
export function readReturnFilters(params: URLSearchParams): ReturnFilters {
  const bucket = params.get('bucket');
  const sourceConnectionId = params.get('sourceConnectionId');
  const createdFrom = params.get('createdFrom');
  const createdTo = params.get('createdTo');
  const segment = params.get('segment');
  const stage = params.get('stage');
  const money = params.get('money');
  const reason = params.get('reason');
  const openedFrom = params.get('openedFrom');
  const openedTo = params.get('openedTo');

  return {
    bucket: isReturnBucket(bucket) ? bucket : undefined,
    sourceConnectionId: sourceConnectionId ?? undefined,
    createdFrom: createdFrom ?? undefined,
    createdTo: createdTo ?? undefined,
    // Every closed union is NARROWED by its guard, never cast: an unrecognised
    // value is dropped rather than forwarded, because the API validates each
    // with `@IsIn` and a URL typo would otherwise 400 the whole page.
    segment: isReturnSegment(segment) ? segment : undefined,
    stage: isReturnStage(stage) ? stage : undefined,
    money: isReturnMoneyState(money) ? money : undefined,
    reason: isReturnLineReason(reason) ? reason : undefined,
    openedFrom: openedFrom ?? undefined,
    openedTo: openedTo ?? undefined,
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
    filters.createdTo !== undefined ||
    // #2378. A dimension missing from this list leaves `Clear filters` hidden
    // while the list is filtered — the operator sees a short list and no way to
    // widen it, which reads as "you have no returns".
    filters.segment !== undefined ||
    filters.stage !== undefined ||
    filters.money !== undefined ||
    filters.reason !== undefined ||
    filters.openedFrom !== undefined ||
    filters.openedTo !== undefined
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
