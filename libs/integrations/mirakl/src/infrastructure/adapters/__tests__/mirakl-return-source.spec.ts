/**
 * Mirakl Return Source: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import {
  FEED_OVERLAP_MS,
  FEED_READ_LAG_MS,
} from '../../../domain/policies/mirakl-order-feed.policy';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import type { MiraklRequestOptions } from '../../http/mirakl-http-client.types';
import { MiraklReturnSource } from '../mirakl-return-source';
import { buildMiraklOrder } from './mirakl-order.fixture';
import { buildMiraklReturn } from './mirakl-return.fixture';

const NOW = new Date('2026-11-23T12:00:00.000Z');

function source(get: jest.Mock): MiraklReturnSource {
  return new MiraklReturnSource('conn-1', { get } as unknown as IMiraklHttpClient, () => NOW);
}

describe('MiraklReturnSource.listReturnFeed', () => {
  it('should read a closed last-updated window and emit one item per change', async () => {
    const get = jest.fn().mockResolvedValue({
      status: 200,
      data: { data: [buildMiraklReturn(), buildMiraklReturn()], next_page_token: null },
    });

    const feed = await source(get).listReturnFeed({
      fromCursor: '2026-11-23T11:00:00.000Z',
      limit: 100,
    });

    const to = new Date(NOW.getTime() - FEED_READ_LAG_MS).toISOString();
    expect(get).toHaveBeenCalledWith('/api/returns', {
      queryParams: {
        return_last_updated_from: new Date(
          Date.parse('2026-11-23T11:00:00.000Z') - FEED_OVERLAP_MS
        ).toISOString(),
        return_last_updated_to: to,
        limit: 100,
        page_token: undefined,
      },
    });
    expect(feed).toEqual({
      items: [
        {
          externalReturnId: 'R-1001',
          externalOrderId: '1001-A',
          occurredAt: '2026-11-23T10:05:00Z',
          eventKey: 'R-1001:2026-11-23T10:05:00Z',
        },
      ],
      nextCursor: to,
    });
  });
});

describe('MiraklReturnSource.getReturn', () => {
  it('should read the return by id and its order for the line SKUs', async () => {
    const get = jest.fn((path: string, options?: MiraklRequestOptions) =>
      Promise.resolve(
        path === '/api/returns'
          ? { status: 200, data: { data: [buildMiraklReturn()] } }
          : {
              status: 200,
              data: {
                orders: [
                  buildMiraklOrder({
                    order_lines: [{ order_line_id: '1001-A-1', offer_sku: 'SKU-1' }],
                  }),
                ],
                total_count: options?.queryParams?.order_ids ? 1 : 0,
              },
            }
      )
    );

    const incoming = await source(get).getReturn({ externalReturnId: 'R-1001' });

    expect(get).toHaveBeenCalledWith('/api/returns', { queryParams: { return_id: 'R-1001' } });
    expect(incoming.lines[0]).toMatchObject({ sku: 'SKU-1' });
  });

  it('should still map the return when its order cannot be read', async () => {
    const get = jest.fn((path: string) =>
      path === '/api/returns'
        ? Promise.resolve({ status: 200, data: { data: [buildMiraklReturn()] } })
        : Promise.reject(new Error('down'))
    );

    expect((await source(get).getReturn({ externalReturnId: 'R-1001' })).lines).toHaveLength(1);
  });

  it('should answer a missing return with a 404 core counts as not found', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200, data: { data: [] } });

    await expect(source(get).getReturn({ externalReturnId: 'gone' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('should declare the terminal states', () => {
    expect(source(jest.fn()).terminalRawStatuses).toEqual(['CLOSED', 'REFUSED', 'CANCELED']);
  });
});
