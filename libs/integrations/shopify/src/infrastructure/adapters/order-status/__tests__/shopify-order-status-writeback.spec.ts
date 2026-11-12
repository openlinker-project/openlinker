import type { Connection } from '@openlinker/core/identifier-mapping';

import { ShopifyUserErrorsException } from '../../../../domain/exceptions/shopify-user-errors.exception';
import type { ShopifyFulfillmentOrder } from '../../../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../../../http/shopify-graphql-client';
import type { ShopifyShopContextProvider } from '../../../shop-context/shopify-shop-context.provider';
import { ShopifyOrderStatusWriteback } from '../shopify-order-status-writeback';

const HERE = 'gid://shopify/Location/1';
const ELSEWHERE = 'gid://shopify/Location/2';

function fo(id: string, location: string, remaining = 1, status = 'OPEN'): ShopifyFulfillmentOrder {
  return {
    id: `gid://shopify/FulfillmentOrder/${id}`,
    status,
    assignedLocation: { location: { id: location } },
    lineItems: { nodes: [{ id: `li-${id}`, remainingQuantity: remaining }] },
  };
}

function orderAnswer(fulfillmentOrders: ShopifyFulfillmentOrder[], extra: Record<string, unknown> = {}): unknown {
  return {
    order: {
      id: 'gid://shopify/Order/1011',
      displayFulfillmentStatus: 'UNFULFILLED',
      cancelledAt: null,
      fulfillmentOrders: { nodes: fulfillmentOrders },
      ...extra,
    },
  };
}

function build(query: jest.Mock, mutate: jest.Mock): ShopifyOrderStatusWriteback {
  return new ShopifyOrderStatusWriteback(
    { query, mutate } as unknown as ShopifyGraphqlClient,
    { get: jest.fn().mockResolvedValue({ locationGid: HERE }) } as unknown as ShopifyShopContextProvider,
    { id: 'c1' } as Connection,
  );
}

describe('ShopifyOrderStatusWriteback', () => {
  it('should fulfil the open work with the tracking number, carrier and URL (L-F3)', async () => {
    const query = jest.fn().mockResolvedValue(orderAnswer([fo('1', HERE)]));
    const mutate = jest.fn().mockResolvedValue({});

    const result = await build(query, mutate).write({
      type: 'dispatched',
      externalOrderId: '1011',
      trackingNumber: '602222296611036022304742',
      carrier: { platformType: 'inpost' },
    });

    expect(result).toEqual({ outcome: 'applied' });
    expect(mutate).toHaveBeenCalledWith(
      expect.stringContaining('fulfillmentCreate'),
      {
        fulfillment: {
          lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1' }],
          trackingInfo: {
            number: '602222296611036022304742',
            company: 'InPost',
            url: 'https://inpost.pl/sledzenie-przesylek?number=602222296611036022304742',
          },
          notifyCustomer: false,
        },
      },
      'fulfillmentCreate',
    );
  });

  it('should move work Shopify routed to another location before fulfilling it (C24)', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(orderAnswer([fo('1', ELSEWHERE)]))
      .mockResolvedValueOnce(orderAnswer([fo('1', HERE)]));
    const mutate = jest.fn().mockResolvedValue({});

    await expect(build(query, mutate).write({ type: 'dispatched', externalOrderId: '1011' })).resolves.toEqual({
      outcome: 'applied',
    });
    expect(mutate.mock.calls.map((call: unknown[]) => call[2])).toEqual(['fulfillmentOrderMove', 'fulfillmentCreate']);
    expect((mutate.mock.calls[0] as unknown[])[1]).toEqual({ id: 'gid://shopify/FulfillmentOrder/1', locationId: HERE });
  });

  it('should answer an order already fulfilled as applied', async () => {
    const query = jest
      .fn()
      .mockResolvedValue(orderAnswer([fo('1', HERE, 0, 'CLOSED')], { displayFulfillmentStatus: 'FULFILLED' }));

    await expect(build(query, jest.fn()).write({ type: 'dispatched', externalOrderId: '1011' })).resolves.toMatchObject({
      outcome: 'applied',
    });
  });

  it('should report a refusal Shopify states as rejected', async () => {
    const query = jest.fn().mockResolvedValue(orderAnswer([fo('1', HERE)]));
    const mutate = jest
      .fn()
      .mockRejectedValue(new ShopifyUserErrorsException('fulfillmentCreate', [{ message: 'Invalid fulfillment order' }]));

    await expect(build(query, mutate).write({ type: 'dispatched', externalOrderId: '1011' })).resolves.toMatchObject({
      outcome: 'rejected',
    });
  });

  it('should cancel an open order and answer one already cancelled as applied', async () => {
    const open = jest.fn().mockResolvedValue(orderAnswer([]));
    const mutate = jest.fn().mockResolvedValue({});
    await expect(build(open, mutate).write({ type: 'cancelled', externalOrderId: '1011' })).resolves.toEqual({
      outcome: 'applied',
    });
    expect((mutate.mock.calls[0] as unknown[])[2]).toBe('orderCancel');

    const cancelled = jest.fn().mockResolvedValue(orderAnswer([], { cancelledAt: '2026-11-05T00:00:00Z' }));
    const noWrite = jest.fn();
    await expect(build(cancelled, noWrite).write({ type: 'cancelled', externalOrderId: '1011' })).resolves.toMatchObject({
      outcome: 'applied',
    });
    expect(noWrite).not.toHaveBeenCalled();
  });

  it('should decline delivered as unsupported', async () => {
    await expect(
      build(jest.fn(), jest.fn()).write({ type: 'delivered', externalOrderId: '1011' }),
    ).resolves.toMatchObject({ outcome: 'unsupported' });
  });
});
