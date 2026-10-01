/**
 * Fulfilment worklist filters (#2410, back-link builders added by #3259)
 *
 * Pure read/write helpers over the `/fulfillment` search params, following the
 * `features/returns/lib/returns-filters.ts` shape.
 *
 * Three rules this module owns.
 *
 * **`offset` is paging, not a filter.** {@link hasActiveFulfillmentFilters}
 * deliberately excludes it: an empty page caused by paging past the end is a
 * different operator situation from an empty page caused by a filter, and
 * conflating the two makes the worklist claim there is nothing to do when there
 * is.
 *
 * **The filter is a free string and is forwarded verbatim.** Unlike the
 * returns list there is no closed union to narrow against here — `orderId` is
 * an opaque id the API takes as `@IsString()`, so there is no guard that could
 * reject one without inventing a format the backend does not enforce. An id that matches nothing answers an empty page, which the page
 * reports as "no matches" rather than as "nothing to do".
 *
 * **The detail page's back link is built here, not re-derived on the detail
 * page.** `fulfillmentWorkDetailPath` / `fulfillmentWorklistPath` share one
 * whitelist ({@link FULFILLMENT_BACK_LINK_PARAMS}) so the two directions of
 * the link can never disagree about which params travel — a detail page that
 * parsed the query string itself could drift from what this module considers
 * a legitimate filter the day a new one is added here.
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import type { FulfillmentTaskFilters } from '../api/fulfillment.types';

/**
 * Every filter param this page owns. `offset` is NOT here — it is paging, and
 * listing it would put it in reach of {@link clearFulfillmentFilters}'
 * semantics for the wrong reason. It is cleared explicitly instead, which is a
 * different statement.
 *
 * `locationId` left the list in #3096. With one location it filtered nothing,
 * and an operator never knows a location's internal id anyway. An old bookmark
 * carrying `?locationId=` is now ignored rather than half-honoured; the API
 * still accepts the param for the day multi-warehouse work brings it back.
 */
export const FULFILLMENT_FILTER_PARAMS = ['orderId'] as const;

export type FulfillmentFilterParam = (typeof FULFILLMENT_FILTER_PARAMS)[number];

export const FULFILLMENT_OFFSET_PARAM = 'offset';

/** Read the filters out of the URL. An empty string is an absent filter. */
export function readFulfillmentFilters(params: URLSearchParams): FulfillmentTaskFilters {
  const orderId = params.get('orderId');

  return {
    // `|| undefined`, not `?? undefined`: `?orderId=` is a present-but-empty
    // param, and sending `orderId=` would filter to the orders whose id is the
    // empty string — i.e. none — while the page reported itself unfiltered.
    orderId: orderId || undefined,
  };
}

/**
 * Read the page offset. A negative, non-numeric or absent value reads as 0 —
 * the first page is always reachable, whatever is in the URL.
 */
export function readFulfillmentOffset(params: URLSearchParams): number {
  const raw = Number(params.get(FULFILLMENT_OFFSET_PARAM) ?? '0');
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

/**
 * Whether any FILTER is narrowing the worklist.
 *
 * Reads the narrowed filters rather than the raw params, so `?orderId=` — which
 * {@link readFulfillmentFilters} already dropped — does not make an unfiltered
 * worklist claim to be filtered.
 */
export function hasActiveFulfillmentFilters(filters: FulfillmentTaskFilters): boolean {
  return filters.orderId !== undefined;
}

/**
 * Set (or clear, on an empty value) one filter param.
 *
 * Always clears `offset`: the row at offset 50 of the unfiltered worklist is
 * not the row at offset 50 of the filtered one, so keeping the offset lands the
 * operator on an arbitrary — usually empty — page.
 */
export function setFulfillmentFilterParam(
  params: URLSearchParams,
  key: FulfillmentFilterParam,
  value: string
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  next.delete(FULFILLMENT_OFFSET_PARAM);
  return next;
}

/** Drop every filter param (and the offset) in one call. */
export function clearFulfillmentFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of FULFILLMENT_FILTER_PARAMS) next.delete(key);
  next.delete(FULFILLMENT_OFFSET_PARAM);
  return next;
}

/** Move to a page offset, dropping the param entirely at the first page. */
export function setFulfillmentOffsetParam(
  params: URLSearchParams,
  offset: number
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (offset <= 0) next.delete(FULFILLMENT_OFFSET_PARAM);
  else next.set(FULFILLMENT_OFFSET_PARAM, String(offset));
  return next;
}

/**
 * Every param the `/fulfillment` screen's own STATE carries (#3259).
 *
 * Wider than {@link FULFILLMENT_FILTER_PARAMS}: this list is for the
 * back-and-forth link between the screen and one task's detail page, which
 * has to carry the whole address an operator navigated FROM, not only the
 * two server-side filters — `offset` (paging) and `groupBy` (the screen's
 * staffing/location axis switch, owned by `assign-packing-work-page.tsx`
 * rather than by this module, but the URL param it reads and writes all the
 * same) ride along too. A whitelist rather than "forward everything" so a
 * stray param on the address bar never rides along uninvited.
 */
export const FULFILLMENT_BACK_LINK_PARAMS = [
  ...FULFILLMENT_FILTER_PARAMS,
  FULFILLMENT_OFFSET_PARAM,
  'groupBy',
] as const;

/** The subset of `params` this feature's own screen owns, in one query string. */
function pickFulfillmentBackLinkParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  for (const key of FULFILLMENT_BACK_LINK_PARAMS) {
    const value = params.get(key);
    if (value !== null && value !== '') next.set(key, value);
  }
  return next;
}

/**
 * The address of one fulfilment task's detail page (#3096/#3259), carrying
 * the `/fulfillment` screen's own state forward so the detail page's back
 * link can restore it. Pass an empty `URLSearchParams()` from a caller with
 * no worklist position to preserve (the order-detail panel).
 */
export function fulfillmentWorkDetailPath(workId: string, params: URLSearchParams): string {
  const query = pickFulfillmentBackLinkParams(params).toString();
  return `/fulfillment/works/${encodeURIComponent(workId)}${query.length > 0 ? `?${query}` : ''}`;
}

/** The `/fulfillment` screen's own address, restoring the given state. */
export function fulfillmentWorklistPath(params: URLSearchParams): string {
  const query = pickFulfillmentBackLinkParams(params).toString();
  return `/fulfillment${query.length > 0 ? `?${query}` : ''}`;
}
