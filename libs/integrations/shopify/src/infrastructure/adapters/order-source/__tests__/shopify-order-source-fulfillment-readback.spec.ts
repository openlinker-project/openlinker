import type { Connection } from '@openlinker/core/identifier-mapping';
import type { OrderStatusWriteback } from '@openlinker/core/orders';
import { isOrderFulfillmentReadback } from '@openlinker/core/orders';

import type { ShopifyGraphqlClient } from '../../../http/shopify-graphql-client';
import { ShopifyOrderSourceAdapter } from '../shopify-order-source.adapter';

function build(query: jest.Mock): ShopifyOrderSourceAdapter {
  return new ShopifyOrderSourceAdapter(
    { query } as unknown as ShopifyGraphqlClient,
    'dev.myshopify.com',
    { id: 'c1' } as Connection,
    { write: jest.fn() } as OrderStatusWriteback,
  );
}

const fulfillment = (
  status: string,
  tracking: Array<{ number: string | null; company: string | null }>,
): Record<string, unknown> => ({ status, trackingInfo: tracking });

function answer(order: Record<string, unknown> | null): jest.Mock {
  return jest.fn().mockResolvedValue({ order });
}

const order = (
  displayFulfillmentStatus: string,
  fulfillments: unknown[],
  cancelledAt: string | null = null,
): Record<string, unknown> => ({ id: 'gid://shopify/Order/9', cancelledAt, displayFulfillmentStatus, fulfillments });

describe('ShopifyOrderSourceAdapter.readFulfillment', () => {
  it('should be narrowed by the capability guard', () => {
    expect(isOrderFulfillmentReadback(build(jest.fn()))).toBe(true);
  });

  it('should report a fulfilled order as dispatched with its tracking number and carrier', async () => {
    const query = answer(order('FULFILLED', [fulfillment('SUCCESS', [{ number: 'JJD0001', company: 'DPD' }])]));

    const result = await build(query).readFulfillment({ externalOrderId: '9' });

    expect(result).toEqual({
      outcome: 'read',
      rawStatus: 'FULFILLED',
      dispatched: true,
      waybills: [{ waybill: 'JJD0001', carrierName: 'DPD' }],
    });
    expect(query).toHaveBeenCalledWith(expect.any(String), { id: 'gid://shopify/Order/9' });
  });

  it('should report a partial fulfilment as NOT dispatched, still listing the parcel that left', async () => {
    const query = answer(
      order('PARTIALLY_FULFILLED', [fulfillment('SUCCESS', [{ number: 'P1', company: 'InPost' }])]),
    );

    const result = await build(query).readFulfillment({ externalOrderId: '9' });

    expect(result).toMatchObject({ outcome: 'read', rawStatus: 'PARTIALLY_FULFILLED', dispatched: false });
    expect(result.waybills).toEqual([{ waybill: 'P1', carrierName: 'InPost' }]);
  });

  it('should report an unfulfilled order as not dispatched with no waybills', async () => {
    const result = await build(answer(order('UNFULFILLED', []))).readFulfillment({ externalOrderId: '9' });

    expect(result).toMatchObject({ dispatched: false, waybills: [] });
  });

  it('should report a cancelled order as not dispatched whatever its fulfilment status says', async () => {
    const result = await build(
      answer(order('FULFILLED', [fulfillment('SUCCESS', [{ number: 'X', company: null }])], '2026-11-01T00:00:00Z')),
    ).readFulfillment({ externalOrderId: '9' });

    expect(result).toMatchObject({ rawStatus: 'CANCELLED', dispatched: false });
  });

  it('should ignore the tracking of a cancelled fulfilment', async () => {
    const result = await build(
      answer(
        order('FULFILLED', [
          fulfillment('CANCELLED', [{ number: 'OLD', company: 'DPD' }]),
          fulfillment('SUCCESS', [{ number: 'NEW', company: 'DPD' }]),
        ]),
      ),
    ).readFulfillment({ externalOrderId: '9' });

    expect(result.waybills).toEqual([{ waybill: 'NEW', carrierName: 'DPD' }]);
  });

  it('should report a fulfilled order with no tracking number as dispatched with an empty waybill list', async () => {
    const result = await build(
      answer(order('FULFILLED', [fulfillment('SUCCESS', [{ number: null, company: 'DPD' }, { number: '  ', company: null }])])),
    ).readFulfillment({ externalOrderId: '9' });

    expect(result).toMatchObject({ dispatched: true, waybills: [] });
  });

  it('should list several parcels across several fulfilments once each', async () => {
    const result = await build(
      answer(
        order('FULFILLED', [
          fulfillment('SUCCESS', [{ number: 'A', company: 'DPD' }, { number: 'B', company: null }]),
          fulfillment('SUCCESS', [{ number: 'A', company: 'DPD' }, { number: 'C', company: 'InPost' }]),
        ]),
      ),
    ).readFulfillment({ externalOrderId: '9' });

    expect(result.waybills).toEqual([
      { waybill: 'A', carrierName: 'DPD' },
      { waybill: 'B' },
      { waybill: 'C', carrierName: 'InPost' },
    ]);
  });

  it('should report not-reported waybills when a full page of fulfillments may have been cut off', async () => {
    const full = Array.from({ length: 20 }, (_, i) => fulfillment('SUCCESS', [{ number: `N${i}`, company: null }]));

    const result = await build(answer(order('FULFILLED', full))).readFulfillment({ externalOrderId: '9' });

    expect(result).toMatchObject({ dispatched: true, waybills: null });
  });

  it('should report an unrecognised status as unknown, not as shipped or unshipped', async () => {
    const result = await build(answer(order('SOMETHING_NEW', []))).readFulfillment({ externalOrderId: '9' });

    expect(result).toMatchObject({ outcome: 'read', rawStatus: 'SOMETHING_NEW', dispatched: null });
  });

  it('should answer unavailable, never throw, when Shopify fails or knows no such order', async () => {
    const failing = build(jest.fn().mockRejectedValue(new Error('boom')));
    const missing = build(answer(null));

    await expect(failing.readFulfillment({ externalOrderId: '9' })).resolves.toMatchObject({ outcome: 'unavailable' });
    await expect(missing.readFulfillment({ externalOrderId: '9' })).resolves.toMatchObject({ outcome: 'unavailable' });
  });

  it('should refuse an id that is not a Shopify order id without calling the shop', async () => {
    const query = jest.fn();

    const result = await build(query).readFulfillment({ externalOrderId: 'abc' });

    expect(result.outcome).toBe('unavailable');
    expect(query).not.toHaveBeenCalled();
  });
});
