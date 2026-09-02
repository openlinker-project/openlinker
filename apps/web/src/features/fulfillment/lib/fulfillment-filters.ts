/**
 * Fulfilment worklist filters (#2410)
 *
 * Pure read/write helpers over the `/fulfillment` search params, following the
 * `features/returns/lib/returns-filters.ts` shape.
 *
 * Two rules this module owns.
 *
 * **`offset` is paging, not a filter.** {@link hasActiveFulfillmentFilters}
 * deliberately excludes it: an empty page caused by paging past the end is a
 * different operator situation from an empty page caused by a filter, and
 * conflating the two makes the worklist claim there is nothing to do when there
 * is.
 *
 * **Both filters are free strings and are forwarded verbatim.** Unlike the
 * returns list there is no closed union to narrow against here — `orderId` and
 * `locationId` are opaque ids the API takes as `@IsString()`, so there is no
 * guard that could reject one without inventing a format the backend does not
 * enforce. An id that matches nothing answers an empty page, which the page
 * reports as "no matches" rather than as "nothing to do".
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import type { FulfillmentTaskFilters } from '../api/fulfillment.types';

/**
 * Every param this page owns. `offset` is NOT here — it is paging, and listing
 * it would put it in reach of {@link clearFulfillmentFilters}' semantics for
 * the wrong reason. It is cleared explicitly instead, which is a different
 * statement.
 */
export const FULFILLMENT_FILTER_PARAMS = ['orderId', 'locationId'] as const;

export type FulfillmentFilterParam = (typeof FULFILLMENT_FILTER_PARAMS)[number];

export const FULFILLMENT_OFFSET_PARAM = 'offset';

/** Read the filters out of the URL. An empty string is an absent filter. */
export function readFulfillmentFilters(params: URLSearchParams): FulfillmentTaskFilters {
  const orderId = params.get('orderId');
  const locationId = params.get('locationId');

  return {
    // `|| undefined`, not `?? undefined`: `?orderId=` is a present-but-empty
    // param, and sending `orderId=` would filter to the orders whose id is the
    // empty string — i.e. none — while the page reported itself unfiltered.
    orderId: orderId || undefined,
    locationId: locationId || undefined,
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
  return filters.orderId !== undefined || filters.locationId !== undefined;
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
