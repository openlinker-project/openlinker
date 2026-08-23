/**
 * Orders API query-string serialization tests.
 *
 * `buildQuery` is module-private, so it is exercised through the public client:
 * a recording `request` stub captures the path each method builds. This is the
 * first test of any `buildQuery` in the repo — the function silently DROPS a
 * filter it has no line for, which makes a missing line indistinguishable from a
 * backend that ignores the param (#2100 review).
 */
import { describe, expect, it, vi } from 'vitest';
import { createOrdersApi } from './orders.api';

function recordingApi(): { api: ReturnType<typeof createOrdersApi>; paths: string[] } {
  const paths: string[] = [];
  const request = vi.fn(async (path: string) => {
    paths.push(path);
    return { items: [], total: 0 } as never;
  });
  return { api: createOrdersApi(request), paths };
}

describe('orders api — buildQuery', () => {
  it('serializes the sales-document block filter as an explicit boolean', async () => {
    const { api, paths } = recordingApi();

    await api.list({ salesDocumentBlocked: true }, { limit: 20, offset: 0 });

    expect(paths[0]).toContain('salesDocumentBlocked=true');
  });

  it('serializes an explicit false rather than dropping it', async () => {
    const { api, paths } = recordingApi();

    // The boolean needs a `!== undefined` guard rather than the truthy check the
    // string filters use, or `false` would silently mean "no filter" — a real
    // predicate the API accepts even though the UI does not currently emit it.
    await api.list({ salesDocumentBlocked: false }, { limit: 20, offset: 0 });

    expect(paths[0]).toContain('salesDocumentBlocked=false');
  });

  it('omits the param entirely when the filter is absent', async () => {
    const { api, paths } = recordingApi();

    await api.list({ health: 'synced' }, { limit: 20, offset: 0 });

    expect(paths[0]).toContain('health=synced');
    expect(paths[0]).not.toContain('salesDocumentBlocked');
  });

  it('carries every list filter it is given', async () => {
    const { api, paths } = recordingApi();

    await api.list(
      {
        sourceConnectionId: 'conn-1',
        health: 'needs_attention',
        slaState: 'overdue',
        fulfillmentState: 'not-shipped',
        salesDocumentBlocked: true,
        sort: 'dispatchBy',
        dir: 'asc',
      },
      { limit: 50, offset: 20 },
    );

    const query = paths[0];
    for (const expected of [
      'sourceConnectionId=conn-1',
      'health=needs_attention',
      'slaState=overdue',
      'fulfillmentState=not-shipped',
      'salesDocumentBlocked=true',
      'sort=dispatchBy',
      'dir=asc',
      'limit=50',
      'offset=20',
    ]) {
      expect(query).toContain(expected);
    }
  });

  it('does not leak the block filter into the summary scope', async () => {
    const { api, paths } = recordingApi();

    // The health summary is deliberately NOT self-filtered, so the aggregate
    // cannot be narrowed into a contradiction by the very filter it feeds.
    await api.statusSummary({ sourceConnectionId: 'conn-1' });

    expect(paths[0]).toContain('sourceConnectionId=conn-1');
    expect(paths[0]).not.toContain('salesDocumentBlocked');
  });
});


describe('orders api — packed writes (#2288)', () => {
  function recordingApiWithInit(): {
    api: ReturnType<typeof createOrdersApi>;
    calls: { path: string; init?: RequestInit }[];
  } {
    const calls: { path: string; init?: RequestInit }[] = [];
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      return {} as never;
    });
    return { api: createOrdersApi(request), calls };
  }

  it('POSTs to the packed sub-resource and encodes the order id', async () => {
    const { api, calls } = recordingApiWithInit();

    await api.markPacked('ol/order 1');

    expect(calls[0].path).toBe('/orders/ol%2Forder%201/packed');
    expect(calls[0].init?.method).toBe('POST');
  });

  it('DELETEs the same path to clear the mark', async () => {
    const { api, calls } = recordingApiWithInit();

    await api.unmarkPacked('ol_order_1');

    expect(calls[0].path).toBe('/orders/ol_order_1/packed');
    expect(calls[0].init?.method).toBe('DELETE');
  });
});
