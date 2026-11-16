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

function orderAnswer(
  fulfillmentOrders: ShopifyFulfillmentOrder[],
  extra: Record<string, unknown> = {}
): unknown {
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
    {
      get: jest.fn().mockResolvedValue({ locationGid: HERE }),
    } as unknown as ShopifyShopContextProvider,
    { id: 'c1' } as Connection
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
      'fulfillmentCreate'
    );
  });

  it('should move work Shopify routed to another location before fulfilling it (C24)', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(orderAnswer([fo('1', ELSEWHERE)]))
      .mockResolvedValueOnce(orderAnswer([fo('1', HERE)]));
    const mutate = jest.fn().mockResolvedValue({});

    await expect(
      build(query, mutate).write({ type: 'dispatched', externalOrderId: '1011' })
    ).resolves.toEqual({
      outcome: 'applied',
    });
    expect(mutate.mock.calls.map((call: unknown[]) => call[2])).toEqual([
      'fulfillmentOrderMove',
      'fulfillmentCreate',
    ]);
    expect((mutate.mock.calls[0] as unknown[])[1]).toEqual({
      id: 'gid://shopify/FulfillmentOrder/1',
      locationId: HERE,
    });
  });

  it('should answer an order already fulfilled as applied', async () => {
    const query = jest
      .fn()
      .mockResolvedValue(
        orderAnswer([fo('1', HERE, 0, 'CLOSED')], { displayFulfillmentStatus: 'FULFILLED' })
      );

    await expect(
      build(query, jest.fn()).write({ type: 'dispatched', externalOrderId: '1011' })
    ).resolves.toMatchObject({
      outcome: 'applied',
    });
  });

  describe('tracking number that arrives after the fulfillment', () => {
    const NUMBER = '601001086600153020827662';
    const fulfilled = (fulfillments: unknown[]): unknown =>
      orderAnswer([fo('1', HERE, 0, 'CLOSED')], {
        displayFulfillmentStatus: 'FULFILLED',
        fulfillments,
      });
    const late = {
      type: 'dispatched' as const,
      externalOrderId: '1011',
      trackingNumber: NUMBER,
      carrier: { platformType: 'inpost' },
    };

    it('should add the number to the newest successful fulfillment that has none', async () => {
      const query = jest.fn().mockResolvedValue(
        fulfilled([
          {
            id: 'gid://shopify/Fulfillment/1',
            status: 'SUCCESS',
            createdAt: '2026-11-16T10:00:00Z',
            trackingInfo: [],
          },
          {
            id: 'gid://shopify/Fulfillment/2',
            status: 'SUCCESS',
            createdAt: '2026-11-16T12:00:00Z',
            trackingInfo: [],
          },
          {
            id: 'gid://shopify/Fulfillment/3',
            status: 'CANCELLED',
            createdAt: '2026-11-16T13:00:00Z',
            trackingInfo: [],
          },
        ])
      );
      const mutate = jest.fn().mockResolvedValue({});

      await expect(build(query, mutate).write(late)).resolves.toMatchObject({ outcome: 'applied' });
      expect(mutate).toHaveBeenCalledWith(
        expect.stringContaining('fulfillmentTrackingInfoUpdate'),
        {
          fulfillmentId: 'gid://shopify/Fulfillment/2',
          trackingInfoInput: {
            number: NUMBER,
            company: 'InPost',
            url: `https://inpost.pl/sledzenie-przesylek?number=${NUMBER}`,
          },
          notifyCustomer: false,
        },
        'fulfillmentTrackingInfoUpdate'
      );
    });

    it('should not write when a fulfillment already shows this number', async () => {
      const query = jest
        .fn()
        .mockResolvedValue(
          fulfilled([
            {
              id: 'gid://shopify/Fulfillment/1',
              status: 'SUCCESS',
              createdAt: '2026-11-16T10:00:00Z',
              trackingInfo: [{ number: NUMBER }],
            },
          ])
        );
      const mutate = jest.fn();

      await expect(build(query, mutate).write(late)).resolves.toMatchObject({ outcome: 'applied' });
      expect(mutate).not.toHaveBeenCalled();
    });

    it('should never overwrite a number that is already on the fulfillment', async () => {
      const query = jest
        .fn()
        .mockResolvedValue(
          fulfilled([
            {
              id: 'gid://shopify/Fulfillment/1',
              status: 'SUCCESS',
              createdAt: '2026-11-16T10:00:00Z',
              trackingInfo: [{ number: 'OTHER-1' }],
            },
          ])
        );
      const mutate = jest.fn();

      await expect(build(query, mutate).write(late)).resolves.toMatchObject({
        outcome: 'applied',
        detail: expect.stringContaining('another tracking number'),
      });
      expect(mutate).not.toHaveBeenCalled();
    });

    it('should report a refusal of the tracking update as rejected', async () => {
      const query = jest
        .fn()
        .mockResolvedValue(
          fulfilled([
            {
              id: 'gid://shopify/Fulfillment/1',
              status: 'SUCCESS',
              createdAt: '2026-11-16T10:00:00Z',
              trackingInfo: [],
            },
          ])
        );
      const mutate = jest
        .fn()
        .mockRejectedValue(
          new ShopifyUserErrorsException('fulfillmentTrackingInfoUpdate', [
            { message: 'Fulfillment is not editable' },
          ])
        );

      await expect(build(query, mutate).write(late)).resolves.toMatchObject({
        outcome: 'rejected',
      });
    });
  });

  it('should report a refusal Shopify states as rejected', async () => {
    const query = jest.fn().mockResolvedValue(orderAnswer([fo('1', HERE)]));
    const mutate = jest
      .fn()
      .mockRejectedValue(
        new ShopifyUserErrorsException('fulfillmentCreate', [
          { message: 'Invalid fulfillment order' },
        ])
      );

    await expect(
      build(query, mutate).write({ type: 'dispatched', externalOrderId: '1011' })
    ).resolves.toMatchObject({
      outcome: 'rejected',
    });
  });

  it('should cancel an open order and answer one already cancelled as applied', async () => {
    const open = jest.fn().mockResolvedValue(orderAnswer([]));
    const mutate = jest.fn().mockResolvedValue({});
    await expect(
      build(open, mutate).write({ type: 'cancelled', externalOrderId: '1011' })
    ).resolves.toEqual({
      outcome: 'applied',
    });
    expect((mutate.mock.calls[0] as unknown[])[2]).toBe('orderCancel');

    const cancelled = jest
      .fn()
      .mockResolvedValue(orderAnswer([], { cancelledAt: '2026-11-05T00:00:00Z' }));
    const noWrite = jest.fn();
    await expect(
      build(cancelled, noWrite).write({ type: 'cancelled', externalOrderId: '1011' })
    ).resolves.toMatchObject({
      outcome: 'applied',
    });
    expect(noWrite).not.toHaveBeenCalled();
  });

  describe('paid (#3963)', () => {
    const paidEvent = {
      type: 'paid' as const,
      externalOrderId: '1011',
      amount: 98.39,
      currency: 'PLN',
      paidOn: 'Allegro',
    };
    const paymentState = (
      displayFinancialStatus: string,
      cancelledAt: string | null = null
    ): unknown => ({
      order: { id: 'gid://shopify/Order/1011', cancelledAt, displayFinancialStatus },
    });

    it('should mark a pending order as paid', async () => {
      const query = jest.fn().mockResolvedValue(paymentState('PENDING'));
      const mutate = jest.fn().mockResolvedValue({ order: { id: 'gid://shopify/Order/1011' } });

      await expect(build(query, mutate).write(paidEvent)).resolves.toEqual({ outcome: 'applied' });
      expect(mutate).toHaveBeenCalledWith(
        expect.stringContaining('orderMarkAsPaid'),
        { input: { id: 'gid://shopify/Order/1011' } },
        'orderMarkAsPaid'
      );
    });

    it('should answer an order Shopify already shows paid as applied without a write', async () => {
      const mutate = jest.fn();

      await expect(
        build(jest.fn().mockResolvedValue(paymentState('PAID')), mutate).write(paidEvent)
      ).resolves.toEqual({
        outcome: 'applied',
        detail: 'already paid on Shopify',
      });
      expect(mutate).not.toHaveBeenCalled();
    });

    it.each([
      ['cancelled', paymentState('PENDING', '2026-11-05T00:00:00Z')],
      ['refunded', paymentState('REFUNDED')],
      ['partially refunded', paymentState('PARTIALLY_REFUNDED')],
      ['voided', paymentState('VOIDED')],
    ])('should refuse to book a payment on a %s order', async (_label, answer) => {
      const mutate = jest.fn();

      await expect(
        build(jest.fn().mockResolvedValue(answer), mutate).write(paidEvent)
      ).resolves.toMatchObject({
        outcome: 'rejected',
      });
      expect(mutate).not.toHaveBeenCalled();
    });

    it('should report a refusal Shopify states as rejected', async () => {
      const mutate = jest
        .fn()
        .mockRejectedValue(
          new ShopifyUserErrorsException('orderMarkAsPaid', [
            { message: 'Order cannot be marked as paid' },
          ])
        );

      await expect(
        build(jest.fn().mockResolvedValue(paymentState('AUTHORIZED')), mutate).write(paidEvent)
      ).resolves.toMatchObject({
        outcome: 'rejected',
        detail: expect.stringContaining('cannot be marked as paid'),
      });
    });

    it('should let a transport failure throw so the payment job retries', async () => {
      const failure = new Error('socket hang up');
      const mutate = jest.fn().mockRejectedValue(failure);

      await expect(
        build(jest.fn().mockResolvedValue(paymentState('PENDING')), mutate).write(paidEvent)
      ).rejects.toBe(failure);
    });
  });

  it('should decline delivered as unsupported', async () => {
    await expect(
      build(jest.fn(), jest.fn()).write({ type: 'delivered', externalOrderId: '1011' })
    ).resolves.toMatchObject({ outcome: 'unsupported' });
  });
});
