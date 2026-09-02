/**
 * Fulfilment worklist filter helpers (#2410).
 *
 * The property that carries real operator consequence is the LAST one: `offset`
 * is paging, not a filter, so a page emptied by paging past the end must not be
 * reported as "no matches for your filters".
 */
import { describe, expect, it } from 'vitest';

import {
  clearFulfillmentFilters,
  hasActiveFulfillmentFilters,
  readFulfillmentFilters,
  readFulfillmentOffset,
  setFulfillmentFilterParam,
  setFulfillmentOffsetParam,
} from './fulfillment-filters';

describe('fulfillment worklist filters', () => {
  it('round-trips both filters through the search params', () => {
    let params = new URLSearchParams();
    params = setFulfillmentFilterParam(params, 'orderId', 'ol_order_1');
    params = setFulfillmentFilterParam(params, 'locationId', 'loc_warsaw');

    expect(readFulfillmentFilters(params)).toEqual({
      orderId: 'ol_order_1',
      locationId: 'loc_warsaw',
    });
  });

  it('reads a present-but-empty param as an absent filter', () => {
    // `?orderId=` would otherwise be forwarded, filtering to the orders whose
    // id is the empty string — i.e. none — while the page reported itself
    // unfiltered.
    const params = new URLSearchParams('orderId=&locationId=');

    expect(readFulfillmentFilters(params)).toEqual({
      orderId: undefined,
      locationId: undefined,
    });
    expect(hasActiveFulfillmentFilters(readFulfillmentFilters(params))).toBe(false);
  });

  it('clears the offset when a filter changes', () => {
    const params = new URLSearchParams('offset=50');
    const next = setFulfillmentFilterParam(params, 'orderId', 'ol_order_1');

    expect(next.get('offset')).toBeNull();
  });

  it('drops the offset param entirely at the first page', () => {
    const params = setFulfillmentOffsetParam(new URLSearchParams('offset=25'), 0);
    expect(params.get('offset')).toBeNull();
    expect(readFulfillmentOffset(params)).toBe(0);
  });

  it('reads a negative or non-numeric offset as the first page', () => {
    expect(readFulfillmentOffset(new URLSearchParams('offset=-5'))).toBe(0);
    expect(readFulfillmentOffset(new URLSearchParams('offset=nonsense'))).toBe(0);
  });

  it('clears every filter and the offset together', () => {
    const params = new URLSearchParams('orderId=a&locationId=b&offset=25&keep=me');
    const next = clearFulfillmentFilters(params);

    expect(hasActiveFulfillmentFilters(readFulfillmentFilters(next))).toBe(false);
    expect(next.get('offset')).toBeNull();
    // Params this page does not own are left alone.
    expect(next.get('keep')).toBe('me');
  });

  it('does NOT treat a page offset as an active filter', () => {
    // The red-first break for this one is adding `offset` to the predicate:
    // an operator who paged past the end would then be told their FILTERS
    // matched nothing, and offered a "clear filters" remedy that changes
    // nothing, instead of being sent back to the first page.
    const pagedPastTheEnd = new URLSearchParams('offset=999');

    expect(hasActiveFulfillmentFilters(readFulfillmentFilters(pagedPastTheEnd))).toBe(false);
  });
});
