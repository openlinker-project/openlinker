import type { Connection } from '@openlinker/core/identifier-mapping';
import { ReturnDeclineRejectedBySourceError } from '@openlinker/core/returns';
import {
  isOrderFeedBootstrap,
  isOrderFeedDateBootstrap,
  isOrderWindowReader,
  OrderSyncStartUnavailableError,
  isRefundExecutor, isReturnDecliner, isReturnSourceReader, isSourceOptionsReader } from '@openlinker/core/orders';

import { ShopifyAdapterFactory } from '../../../../application/shopify-adapter.factory';
import type { ShopifyResolution } from '../../../../application/shopify-adapter.factory';
import { ShopifyApiError } from '../../../../domain/exceptions/shopify-api.error';
import { ShopifyOrderTooLargeException } from '../../../../domain/exceptions/shopify-order-too-large.exception';
import { ShopifyReturnNotFoundException } from '../../../../domain/exceptions/shopify-return-not-found.exception';
import { ShopifyUserErrorsException } from '../../../../domain/exceptions/shopify-user-errors.exception';
import type { ShopifyGraphqlClient } from '../../../http/shopify-graphql-client';
import { createShopifyClientRuntime } from '../../../http/shopify-client.builder';
import type { OrderStatusWriteback } from '@openlinker/core/orders';
import { ShopifyOrderSourceAdapter, ShopifyRefundingOrderSourceAdapter } from '../shopify-order-source.adapter';
import type { ShopifyRefundExecutor } from '../shopify-refund-executor';

const CONNECTION = { id: 'c1' } as Connection;
const WRITEBACK: OrderStatusWriteback = { write: jest.fn() };

/**
 * The shop time zone is answered here and never reaches `query`, so a test's own
 * call counts and `mock.calls[0]` keep describing only the order reads.
 */
function build(query: jest.Mock, zone: string | Error | null = 'UTC'): ShopifyOrderSourceAdapter {
  const client = {
    query: (document: string, variables?: unknown): Promise<unknown> => {
      if (document.includes('OlOrderSourceTimeZone')) {
        return zone instanceof Error
          ? Promise.reject(zone)
          : Promise.resolve({ shop: { ianaTimezone: zone } });
      }
      return query(document, variables) as Promise<unknown>;
    },
  };
  return new ShopifyOrderSourceAdapter(
    client as unknown as ShopifyGraphqlClient,
    'dev.myshopify.com',
    CONNECTION,
    WRITEBACK,
  );
}

/** The document and variables of the first query a test made. */
function firstQuery(query: jest.Mock): { document: string; filter: string } {
  const [document, variables] = query.mock.calls[0] as [string, { query: string }];
  return { document, filter: variables.query };
}

const feedRow = (id: string, updatedAt: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `gid://shopify/Order/${id}`,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt,
  cancelledAt: null,
  ...extra,
});

const MONEY = { shopMoney: { amount: '10.00', currencyCode: 'PLN' } };
const lineNode = (id: string): Record<string, unknown> => ({
  id: `gid://shopify/LineItem/${id}`,
  name: 'Mug',
  sku: 'MUG',
  quantity: 1,
  currentQuantity: 1,
  variant: { id: 'gid://shopify/ProductVariant/1' },
  product: { id: 'gid://shopify/Product/1' },
  originalUnitPriceSet: MONEY,
  discountedUnitPriceAfterAllDiscountsSet: MONEY,
  taxLines: [],
});
function orderNode(lineItems: unknown, shippingPageInfo = { hasNextPage: false }): Record<string, unknown> {
  return {
    id: 'gid://shopify/Order/9',
    name: '#9',
    createdAt: '2026-11-04T10:00:00Z',
    updatedAt: '2026-11-04T10:00:00Z',
    processedAt: null,
    cancelledAt: null,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    paymentGatewayNames: ['manual'],
    email: null,
    phone: null,
    note: null,
    taxesIncluded: true,
    currencyCode: 'PLN',
    presentmentCurrencyCode: 'PLN',
    customer: null,
    currentTotalPriceSet: MONEY,
    currentSubtotalPriceSet: MONEY,
    currentTotalTaxSet: MONEY,
    currentShippingPriceSet: MONEY,
    purchasingEntity: null,
    shippingAddress: null,
    billingAddress: null,
    shippingLines: { nodes: [], pageInfo: shippingPageInfo },
    lineItems,
  };
}

describe('ShopifyOrderSourceAdapter', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-05T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getOrder', () => {
    it('should page the lines past the first 250 so the order is ingested whole', async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({
          order: orderNode({ nodes: [lineNode('1'), lineNode('2')], pageInfo: { hasNextPage: true, endCursor: 'c1' } }),
        })
        .mockResolvedValueOnce({
          order: { lineItems: { nodes: [lineNode('3')], pageInfo: { hasNextPage: false, endCursor: null } } },
        });

      const incoming = await build(query).getOrder({ externalOrderId: '9' });

      expect(incoming.items.map((i) => i.id)).toEqual(['1', '2', '3']);
      expect((query.mock.calls[1] as unknown[])[1]).toEqual({ id: 'gid://shopify/Order/9', after: 'c1' });
    });

    it('should refuse an order whose shipping lines do not fit rather than ingest it partially', async () => {
      const query = jest.fn().mockResolvedValue({
        order: orderNode({ nodes: [lineNode('1')], pageInfo: { hasNextPage: false } }, { hasNextPage: true }),
      });

      await expect(build(query).getOrder({ externalOrderId: '9' })).rejects.toBeInstanceOf(
        ShopifyOrderTooLargeException,
      );
    });
  });

  describe('listOrderFeed', () => {
    it('should hand out settled orders after the cursor and hold back the last 30 s (L-S2j)', async () => {
      const query = jest.fn().mockResolvedValue({
        orders: {
          nodes: [
            feedRow('1', '2026-11-05T11:00:00Z'),
            feedRow('2', '2026-11-05T11:30:00Z', { cancelledAt: '2026-11-05T11:30:00Z' }),
            feedRow('3', '2026-11-05T11:59:50Z'),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      });

      const scopes = { currentAppInstallation: { accessScopes: [{ handle: 'read_all_orders' }] } };
      const answering = jest
        .fn()
        .mockImplementation((document: string, variables: unknown): Promise<unknown> =>
          document.includes('OlOrderSourceScopes')
            ? Promise.resolve(scopes)
            : (query(document, variables) as Promise<unknown>),
        );
      const out = await build(answering).listOrderFeed({ fromCursor: null, limit: 10 });

      expect(out.items.map((i) => [i.externalOrderId, i.eventType])).toEqual([
        ['1', 'updated'],
        ['2', 'cancelled'],
      ]);
      expect(out.nextCursor).toBe('v1|2026-11-05T11:30:00.000Z|2');
      expect((query.mock.calls[0] as unknown[])[1]).toMatchObject({ query: "updated_at:>='1970-01-01T00:00:00Z'" });
    });

    it('should keep polling a cursor-less connection when read_all_orders is missing instead of failing every poll', async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ currentAppInstallation: { accessScopes: [] } })
        .mockResolvedValue({ orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
      const out = await build(query).listOrderFeed({ fromCursor: null, limit: 10 });
      expect(out.items).toEqual([]);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('should rethrow an auth rejection from the scope check so the connection can move to needs_reauth', async () => {
      const rejection = new ShopifyApiError(401, 'Unauthorized');
      const query = jest.fn().mockRejectedValue(rejection);
      await expect(build(query).listOrderFeed({ fromCursor: null, limit: 10 })).rejects.toBe(rejection);
    });

    it('should run the whole-history scope check when the cursor is blank', async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ currentAppInstallation: { accessScopes: [] } })
        .mockResolvedValue({ orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
      await build(query).listOrderFeed({ fromCursor: '  ', limit: 10 });
      expect((query.mock.calls[0] as unknown[])[0]).toContain('OlOrderSourceScopes');
    });

    it('should fail a cursor-less poll with a retryable error when the scopes cannot be read', async () => {
      const query = jest.fn().mockRejectedValue(new Error('boom'));
      const failure = await build(query)
        .listOrderFeed({ fromCursor: null, limit: 10 })
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(OrderSyncStartUnavailableError);
    });

    it('should not check the scope on the live feed', async () => {
      const query = jest.fn().mockResolvedValue({ orders: { nodes: [], pageInfo: { hasNextPage: false } } });
      await build(query).listOrderFeed({ fromCursor: 'v1|2026-11-05T11:00:00.000Z|5', limit: 10 });
      expect(
        query.mock.calls.some(([document]) => (document as string).includes('OlOrderSourceScopes')),
      ).toBe(false);
    });

    it('should skip an order the cursor already covers at the same timestamp', async () => {
      const query = jest.fn().mockResolvedValue({
        orders: {
          nodes: [feedRow('5', '2026-11-05T11:00:00Z'), feedRow('6', '2026-11-05T11:00:00Z')],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      });

      const out = await build(query).listOrderFeed({ fromCursor: 'v1|2026-11-05T11:00:00.000Z|5', limit: 10 });

      expect(out.items.map((i) => i.externalOrderId)).toEqual(['6']);
    });

    it('should keep the cursor when nothing settled came in', async () => {
      const query = jest.fn().mockResolvedValue({ orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });

      await expect(
        build(query).listOrderFeed({ fromCursor: 'v1|2026-11-05T11:00:00.000Z|5', limit: 10 }),
      ).resolves.toEqual({ items: [], nextCursor: 'v1|2026-11-05T11:00:00.000Z|5' });
    });

    it('should refuse a cursor it did not write instead of starting over', async () => {
      await expect(build(jest.fn()).listOrderFeed({ fromCursor: 'allegro-event-1', limit: 10 })).rejects.toBeInstanceOf(
        RangeError,
      );
    });
  });

  describe('headCursor', () => {
    it('should read the newest order by updatedAt and format a feed cursor', async () => {
      const query = jest.fn().mockResolvedValue({
        orders: { nodes: [feedRow('42', '2026-11-05T11:59:50Z')], pageInfo: { hasNextPage: true, endCursor: 'x' } },
      });
      await expect(build(query).headCursor()).resolves.toBe('v1|2026-11-05T11:59:50.000Z|42');
      const [, variables] = query.mock.calls[0] as [string, Record<string, unknown>];
      expect(variables).toEqual({ first: 1, reverse: true });
    });

    it('should return a nothing-older-than-now cursor when the shop has no orders', async () => {
      const query = jest.fn().mockResolvedValue({ orders: { nodes: [], pageInfo: { hasNextPage: false } } });
      const cursor = await build(query).headCursor();
      expect(cursor).toMatch(/^v1\|\d{4}-\d{2}-\d{2}T[\d:.]+Z\|0$/);
    });

    it('should let an empty shop on "now" poll without read_all_orders instead of failing every poll', async () => {
      const query = jest.fn().mockImplementation((document: string) =>
        Promise.resolve(
          document.includes('currentAppInstallation')
            ? { currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }] } }
            : { orders: { nodes: [], pageInfo: { hasNextPage: false } } },
        ),
      );
      const adapter = build(query);
      const cursor = await adapter.headCursor();
      await expect(adapter.listOrderFeed({ fromCursor: cursor, limit: 10 })).resolves.toMatchObject({ items: [] });
    });

    it('should throw when the read fails', async () => {
      const query = jest.fn().mockRejectedValue(new Error('throttled'));
      await expect(build(query).headCursor()).rejects.toThrow('throttled');
    });
  });

  describe('cursorForDate', () => {
    it('should read a bare date as UTC midnight with id 0', async () => {
      const query = jest.fn();
      await expect(build(query).cursorForDate('2026-11-01')).resolves.toBe('v1|2026-11-01T00:00:00.000Z|0');
      expect(query).not.toHaveBeenCalled();
    });

    it('should keep a full instant', async () => {
      await expect(build(jest.fn()).cursorForDate('2026-11-01T10:30:00+01:00')).resolves.toBe(
        'v1|2026-11-01T09:30:00.000Z|0',
      );
    });

    it('should throw OrderSyncStartUnavailableError on an invalid date', async () => {
      await expect(build(jest.fn()).cursorForDate('not-a-date')).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
    });

    it('should refuse an old date when read_all_orders is not granted', async () => {
      const query = jest.fn().mockResolvedValue({
        currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }] },
      });
      await expect(build(query).cursorForDate('2026-01-01')).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
    });

    it('should accept an old date when read_all_orders is granted', async () => {
      const query = jest.fn().mockResolvedValue({
        currentAppInstallation: { accessScopes: [{ handle: 'read_all_orders' }] },
      });
      await expect(build(query).cursorForDate('2026-01-01')).resolves.toBe('v1|2026-01-01T00:00:00.000Z|0');
    });

    it('should refuse an old date when the scopes cannot be read, rather than import less than asked', async () => {
      const query = jest.fn().mockRejectedValue(new Error('boom'));
      await expect(build(query).cursorForDate('2026-01-01')).rejects.toBeInstanceOf(
        OrderSyncStartUnavailableError,
      );
    });

    it('should refuse an old date when the scope answer is absent', async () => {
      const query = jest.fn().mockResolvedValue({ currentAppInstallation: null });
      await expect(build(query).cursorForDate('2026-01-01')).rejects.toBeInstanceOf(
        OrderSyncStartUnavailableError,
      );
    });

    it('should not need the scope for a date inside the last 59 days', async () => {
      const query = jest.fn();
      const recent = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
      await expect(build(query).cursorForDate(recent)).resolves.toMatch(/^v1\|/);
      expect(query).not.toHaveBeenCalled();
    });

    it('should start a bare day at midnight in the shop time zone', async () => {
      await expect(build(jest.fn(), 'Europe/Warsaw').cursorForDate('2026-11-01')).resolves.toBe(
        'v1|2026-10-31T23:00:00.000Z|0',
      );
    });

    it('should read a bare day as UTC when the time zone cannot be read', async () => {
      await expect(build(jest.fn(), new Error('down')).cursorForDate('2026-11-01')).resolves.toBe(
        'v1|2026-11-01T00:00:00.000Z|0',
      );
      await expect(build(jest.fn(), null).cursorForDate('2026-11-01')).resolves.toBe(
        'v1|2026-11-01T00:00:00.000Z|0',
      );
    });

    it('should refuse a day that is not on the calendar', async () => {
      await expect(build(jest.fn()).cursorForDate('2026-13-45')).rejects.toBeInstanceOf(
        OrderSyncStartUnavailableError,
      );
    });
  });

  describe('listOrdersInWindow', () => {
    const page = (nodes: unknown[], hasNextPage: boolean, endCursor: string | null): unknown => ({
      orders: { nodes, pageInfo: { hasNextPage, endCursor } },
    });
    const vars = (query: jest.Mock, call = 0): Record<string, unknown> =>
      (query.mock.calls[call] as [string, Record<string, unknown>])[1];

    it('should filter by placement date with the end day inclusive, oldest first', async () => {
      const query = jest.fn().mockResolvedValue(page([feedRow('1', '2026-11-02T00:00:00Z')], false, null));
      const result = await build(query).listOrdersInWindow({
        from: '2026-11-01',
        to: '2026-11-03',
        direction: 'oldest-first',
        cursor: null,
        limit: 50,
      });
      expect(vars(query)).toMatchObject({
        first: 50,
        after: null,
        reverse: false,
        query: "created_at:>='2026-11-01T00:00:00.000Z' created_at:<='2026-11-03T23:59:59.999Z'",
      });
      expect(result).toEqual({
        items: [
          { externalOrderId: '1', eventType: 'updated', occurredAt: '2026-11-02T00:00:00Z', eventKey: '1:2026-11-02T00:00:00Z' },
        ],
        nextCursor: null,
        done: true,
      });
    });

    it('should read newest first and page with Shopify end cursor', async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce(page([feedRow('3', '2026-11-04T00:00:00Z')], true, 'CUR1'))
        .mockResolvedValueOnce(page([feedRow('2', '2026-11-03T00:00:00Z')], false, 'CUR2'));
      const adapter = build(query);
      const input = { from: '2026-11-01', direction: 'newest-first' as const, limit: 1 };
      const first = await adapter.listOrdersInWindow({ ...input, cursor: null });
      expect(first).toMatchObject({ nextCursor: 'CUR1', done: false });
      expect(vars(query).reverse).toBe(true);
      const second = await adapter.listOrdersInWindow({ ...input, cursor: first.nextCursor });
      expect(vars(query, 1).after).toBe('CUR1');
      expect(second).toMatchObject({ nextCursor: null, done: true });
    });

    it('should clamp the page size to 100 and report an empty window as done', async () => {
      const query = jest.fn().mockResolvedValue(page([], false, null));
      const result = await build(query).listOrdersInWindow({
        from: '2026-11-01',
        direction: 'oldest-first',
        cursor: null,
        limit: 5000,
      });
      expect(vars(query).first).toBe(100);
      expect(vars(query).query).toBe("created_at:>='2026-11-01T00:00:00.000Z'");
      expect(result).toEqual({ items: [], nextCursor: null, done: true });
    });

    it('should bound a window by the shop days, not UTC days', async () => {
      const query = jest.fn().mockResolvedValue(page([], false, null));
      await build(query, 'America/New_York').listOrdersInWindow({
        from: '2026-11-02',
        to: '2026-11-03',
        direction: 'oldest-first',
        cursor: null,
        limit: 10,
      });
      expect(vars(query).query).toBe(
        "created_at:>='2026-11-02T05:00:00.000Z' created_at:<='2026-11-04T04:59:59.999Z'",
      );
    });

    it('should refuse an unbounded history when the scopes cannot be read', async () => {
      const query = jest.fn().mockRejectedValue(new Error('boom'));
      await expect(
        build(query).listOrdersInWindow({ direction: 'oldest-first', cursor: null, limit: 10 }),
      ).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
    });

    it('should ask for the scopes once across pages of one adapter', async () => {
      const query = jest.fn().mockImplementation((document: string) =>
        Promise.resolve(
          document.includes('OlOrderSourceScopes')
            ? { currentAppInstallation: { accessScopes: [{ handle: 'read_all_orders' }] } }
            : page([], false, null),
        ),
      );
      const adapter = build(query);
      const input = { direction: 'oldest-first' as const, limit: 10 };
      await adapter.listOrdersInWindow({ ...input, cursor: null });
      await adapter.listOrdersInWindow({ ...input, cursor: 'CUR' });
      const scopeReads = query.mock.calls.filter(([document]) =>
        (document as string).includes('OlOrderSourceScopes'),
      );
      expect(scopeReads).toHaveLength(1);
    });

    it('should mark a cancelled order as cancelled', async () => {
      const query = jest
        .fn()
        .mockResolvedValue(page([feedRow('7', '2026-11-03T00:00:00Z', { cancelledAt: '2026-11-03T00:00:00Z' })], false, null));
      const result = await build(query).listOrdersInWindow({
        from: '2026-11-01',
        direction: 'oldest-first',
        cursor: null,
        limit: 10,
      });
      expect(result.items[0]?.eventType).toBe('cancelled');
    });

    it('should refuse an unbounded history when read_all_orders is missing', async () => {
      const query = jest.fn().mockResolvedValue({ currentAppInstallation: { accessScopes: [] } });
      await expect(
        build(query).listOrdersInWindow({ direction: 'oldest-first', cursor: null, limit: 10 }),
      ).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('should throw OrderSyncStartUnavailableError on an invalid date', async () => {
      await expect(
        build(jest.fn()).listOrdersInWindow({ from: 'nope', direction: 'oldest-first', cursor: null, limit: 10 }),
      ).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
    });

    it('should propagate a failed read', async () => {
      const query = jest.fn().mockRejectedValue(new Error('down'));
      await expect(
        build(query).listOrdersInWindow({ from: '2026-11-01', direction: 'oldest-first', cursor: null, limit: 10 }),
      ).rejects.toThrow('down');
    });
  });

  describe('order start capabilities', () => {
    it('should be detected by the core guards', () => {
      const adapter = build(jest.fn());
      expect(isOrderFeedBootstrap(adapter)).toBe(true);
      expect(isOrderFeedDateBootstrap(adapter)).toBe(true);
      expect(isOrderWindowReader(adapter)).toBe(true);
    });

    it('should be kept by the refunding subclass', () => {
      const adapter = new ShopifyRefundingOrderSourceAdapter(
        { query: jest.fn() } as unknown as ShopifyGraphqlClient,
        'dev.myshopify.com',
        CONNECTION,
        WRITEBACK,
        { executeRefund: jest.fn() } as unknown as ShopifyRefundExecutor,
      );
      expect(isOrderFeedBootstrap(adapter)).toBe(true);
      expect(isOrderFeedDateBootstrap(adapter)).toBe(true);
      expect(isOrderWindowReader(adapter)).toBe(true);
      expect(isRefundExecutor(adapter)).toBe(true);
    });
  });

  describe('returns', () => {
    it('should list each return of the orders that carry one, newest order first, and resume below the last order', async () => {
      const query = jest.fn().mockResolvedValue({
        orders: {
          nodes: [
            {
              id: 'gid://shopify/Order/10',
              returns: { nodes: [{ id: 'gid://shopify/Return/77', name: '#1010-R1', status: 'REQUESTED', createdAt: '2026-11-05T10:00:00Z' }] },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      });

      const out = await build(query).listReturnFeed({ fromCursor: null, limit: 10 });

      expect(out.items).toEqual([
        expect.objectContaining({ externalReturnId: '77', externalOrderId: '10', eventKey: '77' }),
      ]);
      expect(out.nextCursor).toMatch(/^rv2\|.*\|10$/);
      expect(firstQuery(query).document).toContain('sortKey: ID, reverse: true');
      expect(firstQuery(query).filter).not.toContain('id:');
    });

    it('should read the next page below the last order of the lap', async () => {
      const query = jest.fn().mockResolvedValue({ orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });

      await build(query).listReturnFeed({ fromCursor: 'rv2|2026-11-05T09:00:00.000Z|10', limit: 10 });

      expect(firstQuery(query).filter).toContain('AND id:<10');
    });

    it('should start a fresh lap from a cursor of the ascending walk', async () => {
      const query = jest.fn().mockResolvedValue({ orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });

      await build(query).listReturnFeed({ fromCursor: 'rv1|2026-11-05T09:00:00.000Z|10', limit: 10 });

      expect(firstQuery(query).filter).not.toContain('id:');
    });

    it('should start a new lap when no order is left', async () => {
      const query = jest.fn().mockResolvedValue({ orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });

      const out = await build(query).listReturnFeed({ fromCursor: 'rv2|2026-11-05T09:00:00.000Z|10', limit: 10 });

      expect(out.items).toEqual([]);
      expect(out.nextCursor).toBe('rv2|2026-11-05T12:00:00.000Z|-');
    });

    it('should raise a not-found for a return Shopify does not have', async () => {
      const query = jest.fn().mockResolvedValue({ node: null });

      await expect(build(query).getReturn({ externalReturnId: '77' })).rejects.toBeInstanceOf(
        ShopifyReturnNotFoundException,
      );
    });

    it('should decline a requested return, with no instant of its own', async () => {
      const query = jest.fn().mockResolvedValue({ returnDeclineRequest: { return: { status: 'DECLINED' }, userErrors: [] } });

      await expect(
        build(query).declineReturn({ externalReturnId: '77', reasonCode: 'FINAL_SALE', comment: 'worn' } as never),
      ).resolves.toMatchObject({ declinedAt: null, rawStatus: 'DECLINED' });
      expect((query.mock.calls[0] as unknown[])[1]).toEqual({
        input: { id: 'gid://shopify/Return/77', declineReason: 'FINAL_SALE', notifyCustomer: false, declineNote: 'worn' },
      });
    });

    it('should answer a return already declined as a success and refuse anything else', async () => {
      const refused = { returnDeclineRequest: { return: null, userErrors: [{ code: 'INVALID_STATE', message: 'not requested' }] } };
      const alreadyDeclined = jest.fn().mockResolvedValueOnce(refused).mockResolvedValueOnce({ node: { status: 'DECLINED' } });
      const open = jest.fn().mockResolvedValueOnce(refused).mockResolvedValueOnce({ node: { status: 'OPEN' } });
      const command = { externalReturnId: '77', reasonCode: 'OTHER' } as never;

      await expect(build(alreadyDeclined).declineReturn(command)).resolves.toMatchObject({ rawStatus: 'DECLINED' });
      await expect(build(open).declineReturn(command)).rejects.toBeInstanceOf(ReturnDeclineRejectedBySourceError);
    });

    it('should leave a throttle platform-native so it stays in doubt', async () => {
      const throttled = jest.fn().mockResolvedValueOnce({
        returnDeclineRequest: { return: null, userErrors: [{ code: null, message: 'Too many attempts' }] },
      }).mockResolvedValueOnce({ node: { status: 'REQUESTED' } });

      await expect(build(throttled).declineReturn({ externalReturnId: '77', reasonCode: 'OTHER' } as never)).rejects.toBeInstanceOf(
        ShopifyUserErrorsException,
      );
    });
  });
});

describe('ShopifyAdapterFactory.createOrderSource', () => {
  function resolution(refundsThroughShopify: boolean): ShopifyResolution {
    return {
      connection: CONNECTION,
      config: {
        storeDomain: 'dev.myshopify.com',
        apiVersion: '2026-10',
        locationGid: null,
        stockLocations: 'configured' as const,
        unmanagedStockQuantity: null,
        salesCountryIso2: null,
        refundsThroughShopify,
        codGatewayNames: [],
        bankDepositGatewayNames: [],
      },
      client: {} as ShopifyGraphqlClient,
      shopContext: {} as ShopifyResolution['shopContext'],
    };
  }

  it('should be a refund executor only on a connection that opts in (C20)', () => {
    const factory = new ShopifyAdapterFactory(createShopifyClientRuntime());

    const plain = factory.createOrderSource(resolution(false));
    const refunding = factory.createOrderSource(resolution(true));

    expect(isRefundExecutor(plain)).toBe(false);
    expect(isRefundExecutor(refunding)).toBe(true);
    for (const adapter of [plain, refunding]) {
      expect(isReturnSourceReader(adapter)).toBe(true);
      expect(isReturnDecliner(adapter)).toBe(true);
      expect(isSourceOptionsReader(adapter)).toBe(true);
    }
  });
});
