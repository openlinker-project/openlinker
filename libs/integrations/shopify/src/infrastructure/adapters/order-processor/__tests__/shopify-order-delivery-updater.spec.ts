import type { OrderCreate } from '@openlinker/core/orders';

import type { ShopifyGraphqlClient } from '../../../http/shopify-graphql-client';
import { ShopifyOrderDeliveryUpdater } from '../shopify-order-delivery-updater';

const MONEY = { shopMoney: { amount: '9.99', currencyCode: 'PLN' } };

interface CurrentOrder {
  cancelledAt?: string | null;
  closedAt?: string | null;
  displayFulfillmentStatus?: string;
  note?: string | null;
  customAttributes?: Array<{ key: string; value: string | null }>;
  shippingLines?: Array<{ id: string; title: string; taxLines?: Array<{ rate: number }> }>;
}

function build(current: CurrentOrder | null) {
  const query = jest.fn().mockResolvedValue({
    order:
      current === null
        ? null
        : {
            id: 'gid://shopify/Order/1',
            cancelledAt: null,
            closedAt: null,
            displayFulfillmentStatus: 'UNFULFILLED',
            note: null,
            customAttributes: [],
            ...current,
            shippingLines: {
              nodes: (current.shippingLines ?? []).map((l) => ({ ...l, originalPriceSet: MONEY })),
            },
          },
  });
  const mutate = jest.fn((_doc: string, _vars: unknown, field: string) => {
    if (field === 'orderEditBegin') {
      return Promise.resolve({
        calculatedOrder: { id: 'gid://shopify/CalculatedOrder/9', shippingLines: [{ id: 'gid://shopify/CalculatedShippingLine/5', title: 'old', price: MONEY }] },
      });
    }
    return Promise.resolve({});
  });
  const updater = new ShopifyOrderDeliveryUpdater({ query, mutate } as unknown as ShopifyGraphqlClient, 'c1');
  return { updater, query, mutate };
}

const order = (pickupId: string | null): OrderCreate =>
  ({
    status: 'pending',
    items: [],
    totals: { subtotal: 0, tax: 0, shipping: 9.99, total: 9.99, currency: 'PLN' },
    shipping: { methodId: 'inpost', methodName: 'InPost Paczkomat' },
    ...(pickupId === null ? {} : { pickupPoint: { id: pickupId, name: `Paczkomat ${pickupId}` } }),
  }) as OrderCreate;

const callsOf = (mutate: jest.Mock): unknown[][] => mutate.mock.calls as unknown[][];
const fields = (mutate: jest.Mock): string[] => callsOf(mutate).map((c) => c[2] as string);

describe('ShopifyOrderDeliveryUpdater', () => {
  it('should replace the shipping line, then update attributes and note, for an unfulfilled copy', async () => {
    const { updater, mutate } = build({
      shippingLines: [{ id: 'gid://shopify/ShippingLine/5', title: 'InPost Paczkomat (WAW14A)' }],
      note: 'OpenLinker order 1\nPickup point: WAW14A - Paczkomat WAW14A',
      customAttributes: [
        { key: 'Pickup point', value: 'WAW14A' },
        { key: 'Gift wrap', value: 'yes' },
      ],
    });

    const result = await updater.update('1', order('KRK01M'), {});

    expect(result).toEqual({ outcome: 'updated' });
    expect(fields(mutate)).toEqual([
      'orderUpdate',
      'orderEditBegin',
      'orderEditRemoveShippingLine',
      'orderEditAddShippingLine',
      'orderEditCommit',
    ]);
    const input = (callsOf(mutate)[0][1] as { input: { note: string; customAttributes: unknown } }).input;
    expect(input.note).toBe('OpenLinker order 1\nPickup point: KRK01M - Paczkomat KRK01M');
    expect(input.customAttributes).toEqual([
      { key: 'Gift wrap', value: 'yes' },
      { key: 'Pickup point', value: 'KRK01M' },
      { key: 'Pickup point name', value: 'Paczkomat KRK01M' },
    ]);
    const add = callsOf(mutate)[3][1] as { shippingLine: { title: string; price: unknown } };
    expect(add.shippingLine).toEqual({
      title: 'InPost Paczkomat (KRK01M)',
      price: { amount: '9.99', currencyCode: 'PLN' },
    });
    const remove = callsOf(mutate)[2][1] as { shippingLineId: string };
    expect(remove.shippingLineId).toBe('gid://shopify/CalculatedShippingLine/5');
  });

  it('should keep a taxed shipping line as it is, update only the pickup details and say so', async () => {
    const { updater, mutate } = build({
      shippingLines: [{ id: 'l', title: 'old', taxLines: [{ rate: 0.23 }] }],
    });

    const result = await updater.update('1', order('KRK01M'), {});

    // The edit API cannot carry a tax line onto a replacement line, so replacing
    // it would lower the order's tax and total: the line is not touched at all.
    expect(fields(mutate)).toEqual(['orderUpdate']);
    expect(result).toMatchObject({ outcome: 'updated', detail: expect.stringContaining('VAT') });
  });

  it('should change nothing when the copy already carries the delivery point', async () => {
    const { updater, mutate } = build({
      shippingLines: [{ id: 'l', title: 'InPost Paczkomat (KRK01M)' }],
      note: 'Pickup point: KRK01M - Paczkomat KRK01M',
      customAttributes: [
        { key: 'Pickup point', value: 'KRK01M' },
        { key: 'Pickup point name', value: 'Paczkomat KRK01M' },
      ],
    });

    await expect(updater.update('1', order('KRK01M'), {})).resolves.toEqual({ outcome: 'unchanged' });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('should finish the rest when a previous run applied only the shipping line', async () => {
    const { updater, mutate } = build({
      shippingLines: [{ id: 'l', title: 'InPost Paczkomat (KRK01M)' }],
      customAttributes: [{ key: 'Pickup point', value: 'WAW14A' }],
    });

    await updater.update('1', order('KRK01M'), {});

    expect(fields(mutate)).toEqual(['orderUpdate']);
  });

  it('should drop the pickup details when the order no longer has a locker', async () => {
    const { updater, mutate } = build({
      shippingLines: [{ id: 'l', title: 'InPost Paczkomat (WAW14A)' }],
      note: 'Pickup point: WAW14A',
      customAttributes: [{ key: 'Pickup point', value: 'WAW14A' }],
    });

    await updater.update('1', order(null), {});

    const input = (callsOf(mutate)[0][1] as { input: { note: string; customAttributes: unknown[] } }).input;
    expect(input.note).toBe('');
    expect(input.customAttributes).toEqual([]);
  });

  it('should leave the shipping line alone when the copy has more than one', async () => {
    const { updater, mutate } = build({
      shippingLines: [
        { id: 'a', title: 'x' },
        { id: 'b', title: 'y' },
      ],
    });

    const result = await updater.update('1', order('KRK01M'), {});

    expect(result).toEqual({ outcome: 'updated' });
    expect(fields(mutate)).toEqual(['orderUpdate']);
  });

  it.each([
    [{ cancelledAt: '2026-01-01' }, 'cancelled'],
    [{ closedAt: '2026-01-01' }, 'closed'],
    [{ displayFulfillmentStatus: 'FULFILLED' }, 'fulfilled'],
    [{ displayFulfillmentStatus: 'PARTIALLY_FULFILLED' }, 'fulfilled'],
  ] as Array<[CurrentOrder, string]>)('should refuse %j as %s without editing', async (state, reason) => {
    const { updater, mutate } = build({ shippingLines: [{ id: 'l', title: 'old' }], ...state });

    const result = await updater.update('1', order('KRK01M'), {});

    expect(result).toMatchObject({ outcome: 'refused', reason });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('should refuse as not-found when Shopify no longer has the order', async () => {
    const { updater } = build(null);
    await expect(updater.update('1', order('KRK01M'), {})).resolves.toMatchObject({
      outcome: 'refused',
      reason: 'not-found',
    });
  });
});
