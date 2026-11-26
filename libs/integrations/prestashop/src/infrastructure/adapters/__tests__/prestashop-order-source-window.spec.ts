/**
 * PrestaShop Order Source Adapter - window read tests
 *
 * Covers `listOrdersInWindow` (OrderWindowReader, #4228): id-keyset paging in both
 * directions, the placement-date bounds passed to the webservice, and cursor
 * advance past unreadable rows.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopOrderSourceAdapter } from '../prestashop-order-source.adapter';
import { DEFAULT_INSTALL_ORDER_STATES } from '../../../__tests__/fixtures/prestashop-order-states.fixture';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { PrestashopOrderMapper } from '../../mappers/prestashop-order.mapper';
import type { PrestashopOrder } from '../../mappers/prestashop.mapper.interface';
import type { PrestashopOrderCurrencyResolver } from '../../provisioners/prestashop-order-currency.resolver';

function order(id: number, dateAdd = '2024-06-01 10:00:00'): PrestashopOrder {
  return { id: String(id), date_add: dateAdd, date_upd: dateAdd };
}

describe('PrestashopOrderSourceAdapter.listOrdersInWindow', () => {
  let adapter: PrestashopOrderSourceAdapter;
  let orderCalls: unknown[][];
  let orderPages: (PrestashopOrder[] | Error)[];

  beforeEach(() => {
    orderCalls = [];
    orderPages = [];
    const client = createMockHttpClient();
    client.listResources = jest.fn((resource: string, ...rest: unknown[]) => {
      if (resource === 'order_states') {
        return Promise.resolve([...DEFAULT_INSTALL_ORDER_STATES]);
      }
      orderCalls.push([resource, ...rest]);
      const next = orderPages.shift() ?? [];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    }) as unknown as typeof client.listResources;
    adapter = new PrestashopOrderSourceAdapter(
      client,
      new PrestashopOrderMapper(),
      createTestConnection(),
      {
        resolveOrderCurrencyIso: jest.fn().mockResolvedValue('PLN'),
      } as unknown as PrestashopOrderCurrencyResolver
    );
  });

  it('should page oldest-first by id and resume after the last id read', async () => {
    orderPages = [[order(3), order(4)]];

    const page = await adapter.listOrdersInWindow({
      direction: 'oldest-first',
      cursor: 'id:2',
      limit: 2,
    });

    expect(orderCalls[0]).toEqual(['orders', { sort: ['id_ASC'], idAfter: 2 }, 2, 0]);
    expect(page.items.map((i) => i.externalOrderId)).toEqual(['3', '4']);
    expect(page.nextCursor).toBe('id:4');
    expect(page.done).toBe(false);
  });

  it('should page newest-first by id with an exclusive upper bound', async () => {
    orderPages = [[order(9), order(8)]];

    const page = await adapter.listOrdersInWindow({
      direction: 'newest-first',
      cursor: 'id:10',
      limit: 2,
    });

    expect(orderCalls[0]).toEqual(['orders', { sort: ['id_DESC'], idBefore: 10 }, 2, 0]);
    expect(page.nextCursor).toBe('id:8');
    expect(page.done).toBe(false);
  });

  it('should pass the whole-day window bounds and keep from/to optional', async () => {
    orderPages = [[], [], []];

    await adapter.listOrdersInWindow({
      from: '2024-06-02',
      to: '2024-06-05T13:00:00Z',
      direction: 'oldest-first',
      cursor: null,
      limit: 10,
    });
    // One inclusive window in the shop's own wall clock: the whole first day to the
    // end of the last day.
    expect(orderCalls[0][1]).toEqual({
      sort: ['id_ASC'],
      dateAddBetween: { from: '2024-06-02 00:00:00', to: '2024-06-05 23:59:59' },
    });

    await adapter.listOrdersInWindow({
      from: '2024-06-02',
      direction: 'oldest-first',
      cursor: null,
      limit: 10,
    });
    expect(orderCalls[1][1]).toEqual({
      sort: ['id_ASC'],
      dateAddBetween: { from: '2024-06-02 00:00:00' },
    });

    await adapter.listOrdersInWindow({ direction: 'oldest-first', cursor: null, limit: 10 });
    expect(orderCalls[2][1]).toEqual({ sort: ['id_ASC'] });
  });

  it('should be done with no cursor when the page is shorter than the limit', async () => {
    orderPages = [[order(1)]];

    const page = await adapter.listOrdersInWindow({
      direction: 'oldest-first',
      cursor: null,
      limit: 5,
    });

    expect(page.done).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it('should advance the cursor past an unreadable row', async () => {
    orderPages = [[{ id: '7', date_add: '2024-06-01 10:00:00', date_upd: 'garbage' }]];

    const page = await adapter.listOrdersInWindow({
      direction: 'oldest-first',
      cursor: null,
      limit: 1,
    });

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe('id:7');
    expect(page.done).toBe(false);
  });

  it('should throw when the read fails and on a malformed cursor', async () => {
    orderPages = [new Error('boom')];
    await expect(
      adapter.listOrdersInWindow({ direction: 'oldest-first', cursor: null, limit: 5 })
    ).rejects.toThrow('boom');
    await expect(
      adapter.listOrdersInWindow({ direction: 'oldest-first', cursor: 'nope', limit: 5 })
    ).rejects.toThrow(/Invalid PrestaShop order window cursor/);
  });
});
