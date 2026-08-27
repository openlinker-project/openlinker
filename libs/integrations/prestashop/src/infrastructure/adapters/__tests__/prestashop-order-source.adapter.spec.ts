/**
 * PrestaShop Order Source Adapter Tests
 *
 * Unit tests for PrestashopOrderSourceAdapter post-#328 port reshape.
 * Covers cursor-based `listOrderFeed` and `getOrder({externalOrderId})`
 * against the neutral OrderSourcePort surface.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopOrderSourceAdapter } from '../prestashop-order-source.adapter';
import { DEFAULT_INSTALL_ORDER_STATES } from '../../../__tests__/fixtures/prestashop-order-states.fixture';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { PrestashopOrderMapper } from '../../mappers/prestashop-order.mapper';
import {
  PrestashopApiException,
  PrestashopCurrencyUnknownException,
  PrestashopResourceNotFoundException,
  PrestashopTruncatedReadException,
} from '@openlinker/integrations-prestashop';
import type {
  PrestashopOrder,
  PrestashopOrderRow,
} from '../../mappers/prestashop.mapper.interface';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import type { PrestashopOrderCurrencyResolver } from '../../provisioners/prestashop-order-currency.resolver';

/**
 * Stub order-currency resolver (#2277). The adapter's own contract is "ask the
 * resolver, put the answer on `totals`" — the resolution CHAIN is the
 * resolver's own contract and is covered in its dedicated spec. Stubbing it
 * here also keeps the WebService call counts these tests assert on describing
 * hydration only.
 */
function createStubCurrencyResolver(
  iso = 'PLN'
): jest.Mocked<Pick<PrestashopOrderCurrencyResolver, 'resolveOrderCurrencyIso'>> {
  return {
    resolveOrderCurrencyIso: jest.fn().mockResolvedValue(iso),
  } as unknown as jest.Mocked<Pick<PrestashopOrderCurrencyResolver, 'resolveOrderCurrencyIso'>>;
}

/**
 * The adapter reads the shop's own `order_states` before it reads any order
 * page (#2607), so the state read is answered by the harness rather than by
 * whatever a test scripts for `orders`. Without this, every
 * `mockResolvedValueOnce(orders)` in this file would have its queue consumed by
 * the state read.
 */
function serveOrderStates(client: jest.Mocked<IPrestashopWebserviceClient>): void {
  let listResources = client.listResources;
  const wrap = (inner: jest.Mock): jest.Mock =>
    jest.fn((resource: string, ...rest: unknown[]) =>
      resource === 'order_states'
        ? Promise.resolve([...DEFAULT_INSTALL_ORDER_STATES])
        : (inner as (...args: unknown[]) => unknown)(resource, ...rest)
    ) as unknown as jest.Mock;
  listResources = wrap(listResources as unknown as jest.Mock) as typeof listResources;
  Object.defineProperty(client, 'listResources', {
    configurable: true,
    get: () => listResources,
    set: (next: jest.Mock) => {
      listResources = wrap(next) as typeof listResources;
    },
  });
}

/**
 * The `order_states` read is bookkeeping, not the read a test is about (#2607).
 * Assertions on how many pages the adapter fetched count only the rest.
 */
function listCallsExcludingStates(client: jest.Mocked<IPrestashopWebserviceClient>): unknown[][] {
  const calls = (client.listResources as unknown as jest.Mock<unknown, unknown[]>).mock.calls;
  return calls.filter((call) => call[0] !== 'order_states');
}

describe('PrestashopOrderSourceAdapter', () => {
  let adapter: PrestashopOrderSourceAdapter;
  let mockHttpClient: jest.Mocked<IPrestashopWebserviceClient>;
  let connection: ReturnType<typeof createTestConnection>;
  let orderMapper: PrestashopOrderMapper;
  let currencyResolver: ReturnType<typeof createStubCurrencyResolver>;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    serveOrderStates(mockHttpClient);
    connection = createTestConnection();
    orderMapper = new PrestashopOrderMapper();
    currencyResolver = createStubCurrencyResolver();
    adapter = new PrestashopOrderSourceAdapter(
      mockHttpClient,
      orderMapper,
      connection,
      currencyResolver as unknown as PrestashopOrderCurrencyResolver
    );
  });

  describe('listOrderFeed', () => {
    it('should return feed items with a monotonic cursor advance', async () => {
      const orders: PrestashopOrder[] = [
        {
          id: '1',
          reference: 'ORDER-1',
          date_add: '2024-01-01 10:00:00',
          date_upd: '2024-01-01 10:00:00',
        },
        {
          id: '2',
          reference: 'ORDER-2',
          date_add: '2024-01-02 09:00:00',
          date_upd: '2024-01-02 11:00:00',
        },
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

      const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        externalOrderId: '1',
        eventType: 'created',
        occurredAt: '2024-01-01 10:00:00',
      });
      expect(result.items[1]).toMatchObject({
        externalOrderId: '2',
        eventType: 'updated',
        occurredAt: '2024-01-02 11:00:00',
      });
      expect(result.nextCursor).toBe('2024-01-02 11:00:00|2');
    });

    it('should return input cursor unchanged when the feed is empty', async () => {
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);
      const result = await adapter.listOrderFeed({ fromCursor: '2024-01-01 00:00:00', limit: 10 });
      expect(result.items).toHaveLength(0);
      // Normalised to the one wire format, and never behind the input position.
      expect(result.nextCursor).toBe('2024-01-01 00:00:00|0');
    });

    it('should filter items by requested eventTypes', async () => {
      const orders: PrestashopOrder[] = [
        { id: '1', date_add: '2024-01-01 10:00:00', date_upd: '2024-01-01 10:00:00' },
        { id: '2', date_add: '2024-01-01 10:00:00', date_upd: '2024-01-02 12:00:00' },
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

      const result = await adapter.listOrderFeed({
        fromCursor: null,
        limit: 10,
        eventTypes: ['updated'],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].externalOrderId).toBe('2');
    });

    it('should advance cursor past filtered-out items so a page of non-matching events is not re-fetched', async () => {
      const orders: PrestashopOrder[] = [
        { id: '1', date_add: '2024-01-01 10:00:00', date_upd: '2024-01-01 10:00:00' },
        { id: '2', date_add: '2024-01-02 09:00:00', date_upd: '2024-01-02 12:00:00' },
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

      // Filter excludes every order on the page, but the cursor must still
      // advance to the max observed `date_upd` so the next call does not loop.
      const result = await adapter.listOrderFeed({
        fromCursor: '2024-01-01 00:00:00',
        limit: 10,
        eventTypes: ['cancelled'],
      });

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBe('2024-01-02 12:00:00|2');
    });

    describe('keyset cursor over (date_upd, id) (#2605)', () => {
      it('should sort by date_upd then id and bound date_upd by the shop own wall clock', async () => {
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

        await adapter.listOrderFeed({ fromCursor: '2024-01-01 10:00:00|4', limit: 50 });

        expect(mockHttpClient.listResources).toHaveBeenCalledWith(
          'orders',
          {
            // One second back, so the cursor own second stays in range - the
            // WebService has no `>=`.
            updatedAfter: '2024-01-01 09:59:59',
            sort: ['date_upd_ASC', 'id_ASC'],
          },
          50,
          0
        );
      });

      it('should not skip an order sharing the cursor second with a higher id', async () => {
        // The three orders were all updated in the same second; the previous poll
        // stopped at id 1, so 2 and 3 must still arrive.
        const orders: PrestashopOrder[] = [
          { id: '1', date_add: '2024-05-01 08:00:00', date_upd: '2024-05-01 08:00:00' },
          { id: '2', date_add: '2024-05-01 08:00:00', date_upd: '2024-05-01 08:00:00' },
          { id: '3', date_add: '2024-05-01 08:00:00', date_upd: '2024-05-01 08:00:00' },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({
          fromCursor: '2024-05-01 08:00:00|1',
          limit: 10,
        });

        expect(result.items.map((i) => i.externalOrderId)).toEqual(['2', '3']);
        expect(result.nextCursor).toBe('2024-05-01 08:00:00|3');
      });

      it('should widen the window when a full read was already consumed', async () => {
        const row = (id: string): PrestashopOrder => ({
          id,
          date_add: '2024-05-01 08:00:00',
          date_upd: '2024-05-01 08:00:00',
        });
        mockHttpClient.listResources = jest
          .fn()
          .mockResolvedValueOnce([row('1'), row('2')])
          .mockResolvedValueOnce([row('1'), row('2'), row('3')]);

        const result = await adapter.listOrderFeed({
          fromCursor: '2024-05-01 08:00:00|2',
          limit: 2,
        });

        expect(listCallsExcludingStates(mockHttpClient)).toHaveLength(2);
        // The window grows from the start of the result set; the offset stays 0
        // so a row shifting during the drain cannot slip past a page boundary.
        expect(mockHttpClient.listResources).toHaveBeenLastCalledWith(
          'orders',
          expect.anything(),
          4,
          0
        );
        expect(result.items.map((i) => i.externalOrderId)).toEqual(['3']);
        expect(result.nextCursor).toBe('2024-05-01 08:00:00|3');
      });

      it('should not drop a row when a concurrent update shifts the result set mid-drain', async () => {
        // Under offset paging this lost order 4 for good: order 1 is bumped out
        // of the window while the drain is in progress, every later row shifts
        // down one position, and the second page started past order 4 - which
        // then sorted behind the advanced cursor and was never read again.
        const row = (id: string): PrestashopOrder => ({
          id,
          date_add: '2024-05-01 08:00:00',
          date_upd: '2024-05-01 08:00:00',
        });
        mockHttpClient.listResources = jest
          .fn()
          .mockResolvedValueOnce([row('1'), row('2'), row('3')])
          // Order 1 was updated between the two reads, so it is no longer in
          // this second: the set the shop answers with is one row shorter.
          .mockResolvedValueOnce([row('2'), row('3'), row('4'), row('5')]);

        const result = await adapter.listOrderFeed({
          fromCursor: '2024-05-01 08:00:00|3',
          limit: 3,
        });

        expect(result.items.map((i) => i.externalOrderId)).toEqual(['4', '5']);
        expect(result.nextCursor).toBe('2024-05-01 08:00:00|5');
      });

      it('should never emit a cursor behind the input position', async () => {
        // A shop that ignores the sort hands back an older row last; the read
        // position must not follow it backwards.
        const orders: PrestashopOrder[] = [
          { id: '9', date_add: '2024-05-02 08:00:00', date_upd: '2024-05-02 08:00:00' },
          { id: '1', date_add: '2024-05-01 08:00:00', date_upd: '2024-05-01 08:00:00' },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

        expect(result.nextCursor).toBe('2024-05-02 08:00:00|9');
      });

      it('should restart from the beginning on an unreadable cursor instead of from now', async () => {
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

        await adapter.listOrderFeed({ fromCursor: 'garbage', limit: 10 });

        expect(mockHttpClient.listResources).toHaveBeenCalledWith(
          'orders',
          { sort: ['date_upd_ASC', 'id_ASC'] },
          10,
          0
        );
      });

      it('should answer an empty feed in the keyset format, never the caller string', async () => {
        // One wire format on every path. A legacy bare timestamp answered in
        // its own shape gives core a mixed pair to compare, and its
        // monotonicity guard then reads the transition as unrecognised and
        // stops checking it (#2605 review).
        mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

        const result = await adapter.listOrderFeed({
          fromCursor: '2024-05-01 08:00:00',
          limit: 10,
        });

        expect(result.items).toEqual([]);
        expect(result.nextCursor).toBe('2024-05-01 08:00:00|0');
      });

      it('should answer no cursor at all when the caller cursor was unreadable', async () => {
        // Echoing it back would keep an unreadable value in place for ever.
        mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

        const result = await adapter.listOrderFeed({ fromCursor: 'garbage', limit: 10 });

        expect(result.nextCursor).toBeNull();
      });

      it('should skip a row with no usable date_upd rather than stamping the worker clock', async () => {
        const orders: PrestashopOrder[] = [
          { id: '4', date_add: '2024-05-03 08:00:00' },
          { id: '5', date_add: '2024-05-03 08:00:00', date_upd: '2024-05-03 08:00:01' },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

        expect(result.items.map((i) => i.externalOrderId)).toEqual(['5']);
        expect(result.nextCursor).toBe('2024-05-03 08:00:01|5');
      });

      it('should return the same page whatever the container timezone is', async () => {
        const orders: PrestashopOrder[] = [
          { id: '6', date_add: '2024-05-04 08:00:00', date_upd: '2024-05-04 08:00:00' },
        ];
        const original = process.env.TZ;
        const runIn = async (tz: string): Promise<unknown> => {
          process.env.TZ = tz;
          mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);
          const result = await adapter.listOrderFeed({
            fromCursor: '2024-05-04 07:00:00|0',
            limit: 10,
          });
          return {
            call: listCallsExcludingStates(mockHttpClient)[0],
            cursor: result.nextCursor,
          };
        };

        try {
          expect(await runIn('UTC')).toEqual(await runIn('Pacific/Kiritimati'));
        } finally {
          process.env.TZ = original;
        }
      });
    });

    describe('cancellation detection (#1161)', () => {
      it('should emit a cancelled event for an order in the canceled state (state 6)', async () => {
        const orders: PrestashopOrder[] = [
          {
            id: '7',
            current_state: '6',
            date_add: '2024-03-01 09:00:00',
            date_upd: '2024-03-02 14:00:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

        expect(result.items[0]).toMatchObject({
          externalOrderId: '7',
          eventType: 'cancelled',
          occurredAt: '2024-03-02 14:00:00',
        });
        // eventKey carries the event type so a cancel is dedupe-distinct from a
        // prior created/updated at a different date_upd.
        expect(result.items[0].eventKey).toBe('7:2024-03-02 14:00:00:cancelled');
      });

      it('should take cancellation precedence even when date_add === date_upd', async () => {
        const orders: PrestashopOrder[] = [
          {
            id: '8',
            current_state: '6',
            date_add: '2024-03-03 10:00:00',
            date_upd: '2024-03-03 10:00:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

        expect(result.items[0].eventType).toBe('cancelled');
      });

      it('should keep emitting cancelled for a re-touched order that stays canceled (no flip to updated)', async () => {
        // Regression guard: a still-cancelled order whose date_upd bumped again
        // must NOT read as `updated` (which would re-create it as active).
        const orders: PrestashopOrder[] = [
          {
            id: '9',
            current_state: '6',
            date_add: '2024-03-04 10:00:00',
            date_upd: '2024-03-05 11:30:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({
          fromCursor: '2024-03-05 00:00:00',
          limit: 10,
        });

        expect(result.items[0].eventType).toBe('cancelled');
      });

      it('should not treat a non-canceled updated order as cancelled', async () => {
        const orders: PrestashopOrder[] = [
          {
            id: '10',
            current_state: '2',
            date_add: '2024-03-06 09:00:00',
            date_upd: '2024-03-07 09:00:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

        expect(result.items[0].eventType).toBe('updated');
      });

      it('should classify an order with no current_state as created/updated (undefined guard)', async () => {
        const orders: PrestashopOrder[] = [
          {
            id: '13',
            date_add: '2024-03-12 09:00:00',
            date_upd: '2024-03-13 09:00:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

        expect(result.items[0].eventType).toBe('updated');
      });

      it('should retain a cancelled order when eventTypes filters for ["cancelled"]', async () => {
        const orders: PrestashopOrder[] = [
          {
            id: '11',
            current_state: '6',
            date_add: '2024-03-08 09:00:00',
            date_upd: '2024-03-09 09:00:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({
          fromCursor: null,
          limit: 10,
          eventTypes: ['cancelled'],
        });

        expect(result.items).toHaveLength(1);
        expect(result.items[0].externalOrderId).toBe('11');
      });

      it('should filter out a cancelled order when eventTypes is ["created","updated"]', async () => {
        const orders: PrestashopOrder[] = [
          {
            id: '12',
            current_state: '6',
            date_add: '2024-03-10 09:00:00',
            date_upd: '2024-03-11 09:00:00',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

        const result = await adapter.listOrderFeed({
          fromCursor: null,
          limit: 10,
          eventTypes: ['created', 'updated'],
        });

        expect(result.items).toHaveLength(0);
        // Cursor still advances past the filtered-out cancelled order.
        expect(result.nextCursor).toBe('2024-03-11 09:00:00|12');
      });
    });
  });

  describe('getOrder', () => {
    it('should hydrate a full IncomingOrder by external order id', async () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-042',
        id_customer: '7',
        current_state: '2',
        total_paid: '99.99',
        total_paid_tax_incl: '99.99',
        total_paid_tax_excl: '99.99',
        total_shipping: '0',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 12:00:00',
      };
      const orderRows: PrestashopOrderRow[] = [
        {
          id: '100',
          product_id: '5',
          product_attribute_id: '0',
          product_quantity: '1',
          product_price: '99.99',
          product_reference: 'SKU-5',
        },
      ];

      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce(prestashopOrder);
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orderRows);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.externalOrderId).toBe('42');
      expect(incoming.customerExternalId).toBe('7');
      expect(incoming.createdAt).toBe('2024-01-01 10:00:00');
      expect(incoming.updatedAt).toBe('2024-01-01 12:00:00');
      // Buyer-placed time (#926) is PrestaShop `date_add`.
      expect(incoming.placedAt).toBe('2024-01-01 10:00:00');
      expect(incoming.items).toHaveLength(1);
      expect(incoming.items[0].productRef).toEqual({ type: 'product', externalId: '5' });
    });

    describe('currency (#2277)', () => {
      const orderWithCurrency: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-042',
        id_currency: '2',
        total_paid_tax_incl: '249.00',
        total_paid_tax_excl: '202.44',
        total_shipping: '0',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 12:00:00',
      };

      beforeEach(() => {
        mockHttpClient.getResource = jest.fn().mockResolvedValue(orderWithCurrency);
        mockHttpClient.listResources = jest.fn().mockResolvedValue([]);
      });

      it('should denominate the order in the resolved currency rather than a hardcoded EUR', async () => {
        currencyResolver.resolveOrderCurrencyIso.mockResolvedValueOnce('PLN');

        const incoming = await adapter.getOrder({ externalOrderId: '42' });

        expect(incoming.totals.currency).toBe('PLN');
        expect(incoming.totals.total).toBe(249.0);
      });

      it("should hand the resolver the order's own id_currency and reference", async () => {
        await adapter.getOrder({ externalOrderId: '42' });

        expect(currencyResolver.resolveOrderCurrencyIso).toHaveBeenCalledWith(
          expect.objectContaining({
            connectionId: connection.id,
            idCurrency: '2',
            orderRef: 'ORDER-042',
          })
        );
      });

      it('should fall back to the external order id when the order carries no reference', async () => {
        mockHttpClient.getResource = jest
          .fn()
          .mockResolvedValue({ ...orderWithCurrency, reference: undefined });

        await adapter.getOrder({ externalOrderId: '42' });

        expect(currencyResolver.resolveOrderCurrencyIso).toHaveBeenCalledWith(
          expect.objectContaining({ orderRef: '42' })
        );
      });

      it('should propagate a refusal instead of ingesting the order under a substituted currency', async () => {
        currencyResolver.resolveOrderCurrencyIso.mockRejectedValueOnce(
          new PrestashopCurrencyUnknownException('Currency id 9 unknown in PrestaShop')
        );

        await expect(adapter.getOrder({ externalOrderId: '42' })).rejects.toThrow(
          PrestashopCurrencyUnknownException
        );
      });
    });

    it('should translate a 404 from the webservice client into PrestashopResourceNotFoundException', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockRejectedValueOnce(new PrestashopApiException('Not Found', 404));
      await expect(adapter.getOrder({ externalOrderId: '999' })).rejects.toThrow(
        PrestashopResourceNotFoundException
      );
    });

    it('should propagate non-404 webservice errors unchanged (not mask them as not-found)', async () => {
      const serverError = new PrestashopApiException('Upstream 500', 500);
      mockHttpClient.getResource = jest.fn().mockRejectedValueOnce(serverError);
      await expect(adapter.getOrder({ externalOrderId: '999' })).rejects.toBe(serverError);
    });

    it('should propagate transport errors (no status code) unchanged', async () => {
      const networkError = new Error('ECONNREFUSED');
      mockHttpClient.getResource = jest.fn().mockRejectedValueOnce(networkError);
      await expect(adapter.getOrder({ externalOrderId: '999' })).rejects.toBe(networkError);
    });
  });

  describe('getOrder — pickupPoint resolution', () => {
    const baseOrder: PrestashopOrder = {
      id: '42',
      reference: 'ORDER-042',
      id_customer: '7',
      id_address_delivery: '5',
      current_state: '2',
      total_paid: '99.99',
      date_add: '2024-01-01 10:00:00',
      date_upd: '2024-01-01 12:00:00',
    };
    const baseOrderRows: PrestashopOrderRow[] = [];

    // Resource-keyed getResource mock. Since #<issue> the adapter also hydrates
    // the buyer address (and its country) inside getOrder, so the call sequence
    // is no longer "order then address" — these tests dispatch by (resource,id)
    // instead of relying on call order.
    const keyedGetResource = (address: Record<string, unknown> | Error): void => {
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string, id: string) => {
        if (resource === 'orders') return Promise.resolve(baseOrder);
        if (resource === 'addresses') {
          return address instanceof Error
            ? Promise.reject(address)
            : Promise.resolve({ id, ...address });
        }
        // Country value is irrelevant to pickup-point resolution; any ISO is fine here.
        if (resource === 'countries') return Promise.resolve({ id, iso_code: 'PL' });
        return Promise.resolve({});
      });
    };

    it('should populate pickupPoint when inpostPsModuleType is official_inpost and address2 is a paczkomat code', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection,
        currencyResolver as unknown as PrestashopOrderCurrencyResolver
      );
      keyedGetResource({ address2: 'POZ08A' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toEqual({ id: 'POZ08A' });
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('addresses', '5');
    });

    it('should leave pickupPoint undefined when inpostPsModuleType is none', async () => {
      const noneConnection = createTestConnection({
        config: { inpostPsModuleType: 'none' },
      });
      const noneAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        noneConnection,
        currencyResolver as unknown as PrestashopOrderCurrencyResolver
      );
      keyedGetResource({ address2: 'POZ08A' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await noneAdapter.getOrder({ externalOrderId: '42' });

      // pickupPoint stays undefined because the module type is not official_inpost,
      // even though the address itself is hydrated for the buyer profile.
      expect(incoming.pickupPoint).toBeUndefined();
    });

    it('should leave pickupPoint undefined when inpostPsModuleType is absent', async () => {
      keyedGetResource({ address2: 'POZ08A' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toBeUndefined();
    });

    it('should leave pickupPoint undefined when address2 does not match paczkomat format', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection,
        currencyResolver as unknown as PrestashopOrderCurrencyResolver
      );
      keyedGetResource({ address2: 'Piętro 2' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toBeUndefined();
    });

    it('should leave pickupPoint undefined when address fetch fails', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection,
        currencyResolver as unknown as PrestashopOrderCurrencyResolver
      );
      keyedGetResource(new PrestashopApiException('Not Found', 404));
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toBeUndefined();
    });

    it('should normalise paczkomat code to uppercase', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection,
        currencyResolver as unknown as PrestashopOrderCurrencyResolver
      );
      keyedGetResource({ address2: 'poz08a' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toEqual({ id: 'POZ08A' });
    });

    it('should populate pickupPoint for a three-digit paczkomat code (WAW124)', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection,
        currencyResolver as unknown as PrestashopOrderCurrencyResolver
      );
      keyedGetResource({ address2: 'WAW124' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toEqual({ id: 'WAW124' });
    });

    it('should leave pickupPoint undefined when id_address_delivery is absent', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection,
        currencyResolver as unknown as PrestashopOrderCurrencyResolver
      );
      const orderWithoutAddress: PrestashopOrder = { ...baseOrder, id_address_delivery: undefined };
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string) => {
        if (resource === 'orders') return Promise.resolve(orderWithoutAddress);
        return Promise.resolve({});
      });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toBeUndefined();
      // No address/country round-trips; the only other read is the buyer
      // e-mail hydration (#1928), which is keyed on id_customer, not address.
      expect(mockHttpClient.getResource).toHaveBeenCalledTimes(2);
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('orders', '42');
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('customers', '7');
    });
  });

  describe('getOrder — order line items (PS9 order_details rename)', () => {
    it('should fetch order rows from the order_details resource (renamed from order_rows in PS9)', async () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-042',
        id_customer: '7',
        current_state: '2',
        total_paid: '99.99',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 12:00:00',
      };
      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce(prestashopOrder);
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

      await adapter.getOrder({ externalOrderId: '42' });

      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'order_details',
        { custom: { id_order: '42' }, sort: ['id_ASC'] },
        100,
        0
      );
    });

    it('should ingest every line of an order whose lines span several pages (#2608)', async () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-042',
        id_customer: '7',
        current_state: '2',
        total_paid: '99.99',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 12:00:00',
      };
      const TOTAL_LINES = 250;
      const allRows: PrestashopOrderRow[] = Array.from({ length: TOTAL_LINES }, (_, i) => ({
        id: String(i + 1),
        product_id: String(i + 1),
        product_quantity: '1',
        product_price: '1.00',
        product_reference: `SKU-${i + 1}`,
      }));
      mockHttpClient.getResource = jest.fn().mockResolvedValue(prestashopOrder);
      mockHttpClient.listResources = jest.fn(
        (_resource: string, _filters: unknown, limit?: number, offset?: number) =>
          Promise.resolve(allRows.slice(offset ?? 0, (offset ?? 0) + (limit ?? 100)))
      ) as unknown as jest.Mocked<IPrestashopWebserviceClient>['listResources'];

      const order = await adapter.getOrder({ externalOrderId: '42' });

      expect(order.items).toHaveLength(TOTAL_LINES);
      expect(listCallsExcludingStates(mockHttpClient)).toHaveLength(3);
    });

    it('should refuse the order rather than mirror it with lines missing when the page budget runs out (#2608)', async () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-042',
        id_customer: '7',
        current_state: '2',
        total_paid: '99.99',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 12:00:00',
      };
      const fullPage: PrestashopOrderRow[] = Array.from({ length: 100 }, (_, i) => ({
        id: String(i + 1),
        product_id: String(i + 1),
        product_quantity: '1',
        product_price: '1.00',
      }));
      mockHttpClient.getResource = jest.fn().mockResolvedValue(prestashopOrder);
      mockHttpClient.listResources = jest.fn().mockResolvedValue(fullPage);

      await expect(adapter.getOrder({ externalOrderId: '42' })).rejects.toBeInstanceOf(
        PrestashopTruncatedReadException
      );
    });
  });

  describe('getOrder — buyer address hydration', () => {
    const orderWithAddresses: PrestashopOrder = {
      id: '42',
      reference: 'ORDER-042',
      id_customer: '7',
      id_address_invoice: '11',
      id_address_delivery: '11',
      current_state: '2',
      total_paid: '99.99',
      date_add: '2024-01-01 10:00:00',
      date_upd: '2024-01-01 12:00:00',
    };

    it('should hydrate billing/shipping address from the addresses resource and resolve country ISO-2', async () => {
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string, id: string) => {
        if (resource === 'orders') return Promise.resolve(orderWithAddresses);
        if (resource === 'addresses') {
          return Promise.resolve({
            id,
            firstname: 'Jan',
            lastname: 'Kowalski',
            company: 'ACME Sp. z o.o.',
            address1: 'ul. Testowa 1',
            address2: 'm. 4',
            city: 'Poznań',
            postcode: '60-001',
            phone: '+48123456789',
            id_country: '14',
          });
        }
        if (resource === 'countries') return Promise.resolve({ id, iso_code: 'pl' });
        return Promise.resolve({});
      });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.billingAddress).toEqual({
        firstName: 'Jan',
        lastName: 'Kowalski',
        company: 'ACME Sp. z o.o.',
        address1: 'ul. Testowa 1',
        address2: 'm. 4',
        city: 'Poznań',
        postalCode: '60-001',
        country: 'PL',
        phone: '+48123456789',
      });
      // Delivery uses the same address id (11) → shipping equals billing.
      expect(incoming.shippingAddress).toEqual(incoming.billingAddress);
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('addresses', '11');
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('countries', '14');
    });

    it('should leave country empty and still hydrate the address when the country fetch fails', async () => {
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string, id: string) => {
        if (resource === 'orders') return Promise.resolve(orderWithAddresses);
        if (resource === 'addresses') {
          return Promise.resolve({
            id,
            address1: 'ul. Testowa 1',
            city: 'Poznań',
            postcode: '60-001',
            id_country: '14',
          });
        }
        if (resource === 'countries') return Promise.reject(new Error('boom'));
        return Promise.resolve({});
      });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.billingAddress?.country).toBe('');
      expect(incoming.billingAddress?.address1).toBe('ul. Testowa 1');
    });

    it('should leave addresses undefined when the order carries no address ids', async () => {
      const orderNoAddr: PrestashopOrder = { ...orderWithAddresses };
      delete orderNoAddr.id_address_invoice;
      delete orderNoAddr.id_address_delivery;
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string) => {
        if (resource === 'orders') return Promise.resolve(orderNoAddr);
        return Promise.resolve({});
      });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.billingAddress).toBeUndefined();
      expect(incoming.shippingAddress).toBeUndefined();
      // No address/country round-trips — the order plus the buyer e-mail read
      // (#1928) are the only calls.
      expect(mockHttpClient.getResource).toHaveBeenCalledTimes(2);
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('orders', '42');
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('customers', '7');
    });

    it('should fall back to billing address for shipping when delivery hydration fails', async () => {
      const order: PrestashopOrder = {
        ...orderWithAddresses,
        id_address_invoice: '11',
        id_address_delivery: '22',
      };
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string, id: string) => {
        if (resource === 'orders') return Promise.resolve(order);
        if (resource === 'addresses') {
          if (id === '22') return Promise.reject(new Error('delivery 404'));
          return Promise.resolve({
            id,
            address1: 'Bill St 1',
            city: 'Warsaw',
            postcode: '00-001',
            id_country: '14',
          });
        }
        if (resource === 'countries') return Promise.resolve({ id, iso_code: 'PL' });
        return Promise.resolve({});
      });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.shippingAddress).toEqual(incoming.billingAddress);
      expect(incoming.billingAddress?.address1).toBe('Bill St 1');
    });

    it('should carry the buyer tax id verbatim from vat_number (#2599)', async () => {
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string, id: string) => {
        if (resource === 'orders') return Promise.resolve(orderWithAddresses);
        if (resource === 'addresses') {
          return Promise.resolve({
            id,
            address1: 'ul. Testowa 1',
            city: 'Poznań',
            postcode: '60-001',
            id_country: '14',
            vat_number: ' PL 123-456-78-90 ',
          });
        }
        if (resource === 'countries') return Promise.resolve({ id, iso_code: 'PL' });
        return Promise.resolve({});
      });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.billingAddress?.taxId).toBe('PL 123-456-78-90');
      expect(incoming.shippingAddress?.taxId).toBe('PL 123-456-78-90');
    });

    it('should read a blank vat_number as the shop asserting the buyer has no tax id (#2599)', async () => {
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string, id: string) => {
        if (resource === 'orders') return Promise.resolve(orderWithAddresses);
        if (resource === 'addresses') {
          return Promise.resolve({
            id,
            address1: 'ul. Testowa 1',
            city: 'Poznań',
            postcode: '60-001',
            id_country: '14',
            vat_number: '',
          });
        }
        if (resource === 'countries') return Promise.resolve({ id, iso_code: 'PL' });
        return Promise.resolve({});
      });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.billingAddress?.taxId).toBeNull();
    });

    it('should leave the tax id unknown when the address resource carries no vat_number at all (#2599)', async () => {
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string, id: string) => {
        if (resource === 'orders') return Promise.resolve(orderWithAddresses);
        if (resource === 'addresses') {
          return Promise.resolve({
            id,
            address1: 'ul. Testowa 1',
            city: 'Poznań',
            postcode: '60-001',
            id_country: '14',
          });
        }
        if (resource === 'countries') return Promise.resolve({ id, iso_code: 'PL' });
        return Promise.resolve({});
      });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.billingAddress?.taxId).toBeUndefined();
    });
  });

  describe('getOrder — buyer e-mail hydration (#1928)', () => {
    const baseOrder: PrestashopOrder = {
      id: '42',
      reference: 'ORDER-042',
      id_customer: '7',
      current_state: '2',
      total_paid: '99.99',
      date_add: '2024-01-01 10:00:00',
      date_upd: '2024-01-01 12:00:00',
    };

    /**
     * `customer` as an Error rejects the `customers` read; as a record it
     * resolves. Keyed by resource so the assertion never depends on call order.
     */
    const keyedGetResource = (
      customer: Record<string, unknown> | Error,
      order: PrestashopOrder = baseOrder
    ): void => {
      mockHttpClient.getResource = jest.fn().mockImplementation((resource: string, id: string) => {
        if (resource === 'orders') return Promise.resolve(order);
        if (resource === 'customers') {
          return customer instanceof Error
            ? Promise.reject(customer)
            : Promise.resolve({ id, ...customer });
        }
        return Promise.resolve({});
      });
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);
    };

    it('should populate customerEmail from the customers resource', async () => {
      keyedGetResource({ email: 'buyer@example.com' });

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.customerEmail).toBe('buyer@example.com');
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('customers', '7');
    });

    it('should leave customerEmail undefined and still return the order when the customers read fails', async () => {
      keyedGetResource(new PrestashopApiException('Forbidden', 403));

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      // Best-effort, mirroring hydrateAddress: a revoked `customers` WS
      // permission must not fail ingestion of an otherwise-valid order.
      expect(incoming.customerEmail).toBeUndefined();
      expect(incoming.externalOrderId).toBe('42');
      expect(incoming.customerExternalId).toBe('7');
    });

    it('should leave customerEmail undefined when the customer record carries no email', async () => {
      keyedGetResource({});

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.customerEmail).toBeUndefined();
    });

    it('should treat a blank email as absent rather than emitting an empty string', async () => {
      keyedGetResource({ email: '   ' });

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.customerEmail).toBeUndefined();
    });

    it('should trim surrounding whitespace off the email', async () => {
      keyedGetResource({ email: '  buyer@example.com  ' });

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.customerEmail).toBe('buyer@example.com');
    });

    it('should skip the customers read entirely when the order carries no id_customer', async () => {
      const orderNoCustomer: PrestashopOrder = { ...baseOrder, id_customer: undefined };
      keyedGetResource({ email: 'buyer@example.com' }, orderNoCustomer);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.customerEmail).toBeUndefined();
      expect(incoming.customerExternalId).toBeUndefined();
      expect(mockHttpClient.getResource).not.toHaveBeenCalledWith('customers', expect.anything());
    });

    it('should accept a numeric id_customer', async () => {
      const numericOrder: PrestashopOrder = { ...baseOrder, id_customer: 7 };
      keyedGetResource({ email: 'buyer@example.com' }, numericOrder);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.customerEmail).toBe('buyer@example.com');
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('customers', '7');
    });
  });
});
