/**
 * Mirakl Order Source Adapter: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import {
  isOrderBillingDocumentUploader,
  isOrderFulfillmentReadback,
  isOrderStatusWriteback,
  isReturnSourceReader,
  isSourceOptionsReader,
} from '@openlinker/core/orders';
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import {
  FEED_OVERLAP_MS,
  FEED_READ_LAG_MS,
} from '../../../domain/policies/mirakl-order-feed.policy';
import type { MiraklOrder } from '../../../domain/types/mirakl-order.types';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import type { MiraklRequestOptions } from '../../http/mirakl-http-client.types';
import { MiraklOrderSourceAdapter } from '../mirakl-order-source.adapter';
import { buildMiraklOrder } from './mirakl-order.fixture';

const NOW = new Date('2026-11-23T12:00:00.000Z');
const now = (): Date => NOW;

type Query = NonNullable<MiraklRequestOptions['queryParams']>;

/**
 * A fake OR11: answers the acceptance read from `waiting`, and the feed read
 * from `respondToFeed`, which sees the query so a test can answer by window.
 */
function setup(
  respondToFeed: (query: Query) => { orders: MiraklOrder[]; total_count: number },
  waiting: MiraklOrder[] = [],
): { client: IMiraklHttpClient; get: jest.Mock; put: jest.Mock; feedQueries: Query[] } {
  const feedQueries: Query[] = [];
  const get = jest.fn((_path: string, options?: MiraklRequestOptions) => {
    const query = options?.queryParams ?? {};
    if (query.order_state_codes === 'WAITING_ACCEPTANCE') {
      return Promise.resolve({ status: 200, data: { orders: waiting, total_count: waiting.length } });
    }
    if (query.order_ids !== undefined) {
      return Promise.resolve({ status: 200, data: respondToFeed(query) });
    }
    feedQueries.push(query);
    return Promise.resolve({ status: 200, data: respondToFeed(query) });
  });
  const put = jest.fn().mockResolvedValue({ status: 204, data: undefined });
  return { client: { get, put } as unknown as IMiraklHttpClient, get, put, feedQueries };
}

function page(orders: MiraklOrder[]): { orders: MiraklOrder[]; total_count: number } {
  return { orders, total_count: orders.length };
}

describe('MiraklOrderSourceAdapter.listOrderFeed', () => {
  it('should accept waiting orders before reading the feed', async () => {
    const waiting = buildMiraklOrder({
      order_id: '2002-A',
      order_state: 'WAITING_ACCEPTANCE',
      order_lines: [{ order_line_id: '2002-A-1', order_line_state: 'WAITING_ACCEPTANCE' }],
    });
    const { client, get, put } = setup(() => page([]), [waiting]);

    await new MiraklOrderSourceAdapter('conn-1', client, 'auto', { now }).listOrderFeed({
      fromCursor: null,
      limit: 200,
    });

    expect(put).toHaveBeenCalledWith('/api/orders/2002-A/accept', {
      order_lines: [{ id: '2002-A-1', accepted: true }],
    });
    expect(put.mock.invocationCallOrder[0]).toBeLessThan(get.mock.invocationCallOrder[1]);
  });

  it('should not accept anything when acceptance is off', async () => {
    const { client, get, put } = setup(() => page([]));

    await new MiraklOrderSourceAdapter('conn-1', client, 'off', { now }).listOrderFeed({
      fromCursor: null,
      limit: 200,
    });

    expect(put).not.toHaveBeenCalled();
    expect(
      get.mock.calls.some(
        ([, options]) =>
          (options as MiraklRequestOptions | undefined)?.queryParams?.order_state_codes ===
          'WAITING_ACCEPTANCE',
      ),
    ).toBe(false);
  });

  it('should read a closed window from the cursor and advance the cursor to its end', async () => {
    const { client, feedQueries } = setup(() =>
      page([buildMiraklOrder(), buildMiraklOrder({ order_id: '1002-A', order_state: 'CANCELED' })]),
    );

    const result = await new MiraklOrderSourceAdapter('conn-1', client, 'off', { now }).listOrderFeed({
      fromCursor: '2026-11-23T11:50:00.000Z',
      limit: 200,
    });

    const to = new Date(NOW.getTime() - FEED_READ_LAG_MS).toISOString();
    expect(feedQueries[0]).toMatchObject({
      start_update_date: new Date(Date.parse('2026-11-23T11:50:00.000Z') - FEED_OVERLAP_MS).toISOString(),
      end_update_date: to,
    });
    expect(String(feedQueries[0].order_state_codes)).not.toContain('WAITING_ACCEPTANCE');
    expect(result.nextCursor).toBe(to);
    expect(result.items).toEqual([
      {
        externalOrderId: '1001-A',
        eventType: 'updated',
        occurredAt: '2026-11-23T09:30:00Z',
        eventKey: '1001-A:2026-11-23T09:30:00Z',
        eventId: '1001-A:2026-11-23T09:30:00Z',
      },
      expect.objectContaining({ externalOrderId: '1002-A', eventType: 'cancelled' }),
    ]);
  });

  it('should halve the window until it fits and advance only to the end of what was read', async () => {
    const full = Array.from({ length: 100 }, (_, index) =>
      buildMiraklOrder({ order_id: `o-${index}` }),
    );
    let call = 0;
    const { client, feedQueries } = setup(() => {
      call++;
      // First window: more than one page. Second (halved): fits.
      return call === 1 ? { orders: full, total_count: 150 } : page([buildMiraklOrder()]);
    });

    const result = await new MiraklOrderSourceAdapter('conn-1', client, 'off', { now }).listOrderFeed({
      fromCursor: '2026-11-23T10:00:00.000Z',
      limit: 100,
    });

    expect(feedQueries).toHaveLength(2);
    expect(result.nextCursor).toBe(feedQueries[1].end_update_date);
    expect(Date.parse(String(result.nextCursor))).toBeLessThan(
      Date.parse(String(feedQueries[0].end_update_date)),
    );
    expect(result.items.map((item) => item.externalOrderId)).toEqual(['1001-A']);
  });

  it('should emit one item when the same change is read twice', async () => {
    const { client } = setup(() => page([buildMiraklOrder(), buildMiraklOrder()]));

    const result = await new MiraklOrderSourceAdapter('conn-1', client, 'off', { now }).listOrderFeed({
      fromCursor: null,
      limit: 200,
    });

    expect(result.items).toHaveLength(1);
  });

  it('should honour an event type filter', async () => {
    const { client } = setup(() =>
      page([buildMiraklOrder(), buildMiraklOrder({ order_id: '1002-A', order_state: 'REFUSED' })]),
    );

    const result = await new MiraklOrderSourceAdapter('conn-1', client, 'off', { now }).listOrderFeed({
      fromCursor: null,
      limit: 200,
      eventTypes: ['cancelled'],
    });

    expect(result.items.map((item) => item.externalOrderId)).toEqual(['1002-A']);
  });
});

describe('MiraklOrderSourceAdapter.getOrder', () => {
  it('should read the order by id and map it', async () => {
    const { client, get } = setup(() => page([buildMiraklOrder()]));

    const order = await new MiraklOrderSourceAdapter('conn-1', client, 'off', { now }).getOrder({
      externalOrderId: '1001-A',
    });

    expect(get).toHaveBeenCalledWith('/api/orders', { queryParams: { order_ids: '1001-A' } });
    expect(order.externalOrderId).toBe('1001-A');
  });

  it('should throw a non-retryable not-found when the order is absent', async () => {
    const { client } = setup(() => page([]));

    const error = await new MiraklOrderSourceAdapter('conn-1', client, 'off', { now })
      .getOrder({ externalOrderId: 'missing' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MiraklApiException);
    expect((error as MiraklApiException).miraklCode).toBe('ORDER_NOT_FOUND');
  });
});

describe('MiraklOrderSourceAdapter way back (#4276)', () => {
  it('should be narrowed by every guard core uses on an order source', () => {
    const { client } = setup(() => page([]));
    const adapter = new MiraklOrderSourceAdapter('conn-1', client, 'off', { now });

    expect(isOrderStatusWriteback(adapter)).toBe(true);
    expect(isOrderFulfillmentReadback(adapter)).toBe(true);
    expect(isSourceOptionsReader(adapter)).toBe(true);
    expect(isOrderBillingDocumentUploader(adapter)).toBe(true);
    expect(isReturnSourceReader(adapter)).toBe(true);
    expect(adapter.terminalRawStatuses).toEqual(['CLOSED', 'REFUSED', 'CANCELED']);
  });
});
