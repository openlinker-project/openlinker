/**
 * Fulfilment api client (#2410).
 *
 * The load-bearing case is the FIRST one: #2410 re-expressed `listByOrder`
 * through the new `list`, and that method is #2411's — an emitted URL that
 * changed shape would break the order-detail panel silently, since the mock in
 * every one of its tests answers whatever it is asked.
 */
import { describe, expect, it, vi } from 'vitest';

import { buildFulfillmentWorksPath, createFulfillmentApi } from './fulfillment.api';

function emptyPage(): unknown {
  return { works: [], total: 0, limit: 25, offset: 0 };
}

describe('fulfillment api', () => {
  it('emits the unchanged listByOrder URL after the re-expression', async () => {
    const request = vi.fn().mockResolvedValue(emptyPage());
    await createFulfillmentApi(request).listByOrder('ol_order_1');

    expect(request).toHaveBeenCalledWith('/fulfillment/works?orderId=ol_order_1');
  });

  it('emits only the params that are set', () => {
    expect(buildFulfillmentWorksPath({})).toBe('/fulfillment/works');
    expect(buildFulfillmentWorksPath({ locationId: 'loc_a' })).toBe(
      '/fulfillment/works?locationId=loc_a'
    );
    // `undefined` must never stringify into the query — the DTO would then try
    // to validate the literal "undefined".
    expect(buildFulfillmentWorksPath({ orderId: undefined, limit: 25 })).toBe(
      '/fulfillment/works?limit=25'
    );
  });

  it('emits an offset of zero rather than dropping it', () => {
    // `0` is falsy, so a truthiness test here would silently page from wherever
    // the server defaults to.
    expect(buildFulfillmentWorksPath({ offset: 0 })).toBe('/fulfillment/works?offset=0');
  });

  it('encodes a value that needs escaping', () => {
    expect(buildFulfillmentWorksPath({ orderId: 'a b&c' })).toBe(
      '/fulfillment/works?orderId=a+b%26c'
    );
  });

  it('gets one task by id', async () => {
    const request = vi.fn().mockResolvedValue({
      id: 'ol_work_1',
      orderId: 'ol_order_1',
      status: 'open',
      requestStatus: 'unsubmitted',
      assignmentAttempt: 0,
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
      lines: [],
      activeHolds: [],
      supportedActions: [],
      version: 1,
    });

    await createFulfillmentApi(request).get('ol_work_1');

    expect(request).toHaveBeenCalledWith('/fulfillment/works/ol_work_1');
  });
});
