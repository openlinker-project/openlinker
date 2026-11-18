import type { Connection } from '@openlinker/core/identifier-mapping';
import { ReturnDeclineRejectedBySourceError } from '@openlinker/core/returns';
import { isRefundExecutor, isReturnDecliner, isReturnSourceReader, isSourceOptionsReader } from '@openlinker/core/orders';

import { ShopifyAdapterFactory } from '../../../../application/shopify-adapter.factory';
import type { ShopifyResolution } from '../../../../application/shopify-adapter.factory';
import { ShopifyOrderTooLargeException } from '../../../../domain/exceptions/shopify-order-too-large.exception';
import { ShopifyReturnNotFoundException } from '../../../../domain/exceptions/shopify-return-not-found.exception';
import { ShopifyUserErrorsException } from '../../../../domain/exceptions/shopify-user-errors.exception';
import type { ShopifyGraphqlClient } from '../../../http/shopify-graphql-client';
import { createShopifyClientRuntime } from '../../../http/shopify-client.builder';
import type { OrderStatusWriteback } from '@openlinker/core/orders';
import { ShopifyOrderSourceAdapter } from '../shopify-order-source.adapter';

const CONNECTION = { id: 'c1' } as Connection;
const WRITEBACK: OrderStatusWriteback = { write: jest.fn() };

function build(query: jest.Mock): ShopifyOrderSourceAdapter {
  return new ShopifyOrderSourceAdapter(
    { query } as unknown as ShopifyGraphqlClient,
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

      const out = await build(query).listOrderFeed({ fromCursor: null, limit: 10 });

      expect(out.items.map((i) => [i.externalOrderId, i.eventType])).toEqual([
        ['1', 'updated'],
        ['2', 'cancelled'],
      ]);
      expect(out.nextCursor).toBe('v1|2026-11-05T11:30:00.000Z|2');
      expect((query.mock.calls[0] as unknown[])[1]).toMatchObject({ query: "updated_at:>='1970-01-01T00:00:00Z'" });
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
