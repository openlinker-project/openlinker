import type { OrderCreate } from '@openlinker/core/orders';

import { ShopifyOrderContactRefusedException } from '../../../../domain/exceptions/shopify-order-contact-refused.exception';
import { ShopifyUserErrorsException } from '../../../../domain/exceptions/shopify-user-errors.exception';
import type { ShopifyGraphqlClient } from '../../../http/shopify-graphql-client';
import { ShopifyOrderContactRefresher } from '../shopify-order-contact-refresher';

interface Current {
  cancelledAt?: string | null;
  closedAt?: string | null;
  email?: string | null;
  phone?: string | null;
  shippingAddress?: Record<string, string | null> | null;
}

const ADDRESS = {
  firstName: 'Qa',
  lastName: 'IH',
  company: null,
  address1: 'Testowa 1',
  address2: null,
  city: 'Warszawa',
  zip: '00-001',
  provinceCode: null,
  countryCodeV2: 'PL',
  phone: null,
};

function build(current: Current | null): {
  refresher: ShopifyOrderContactRefresher;
  query: jest.Mock;
  mutate: jest.Mock<Promise<unknown>, [string, Record<string, unknown>, string]>;
} {
  const query = jest.fn().mockResolvedValue({
    order:
      current === null
        ? null
        : { id: 'gid://shopify/Order/1', cancelledAt: null, closedAt: null, email: null, phone: null, shippingAddress: ADDRESS, ...current },
  });
  const mutate = jest.fn<Promise<unknown>, [string, Record<string, unknown>, string]>().mockResolvedValue({
    order: { id: 'gid://shopify/Order/1' },
  });
  const refresher = new ShopifyOrderContactRefresher({ query, mutate } as unknown as ShopifyGraphqlClient, 'c1');
  return { refresher, query, mutate };
}

function order(over: Partial<OrderCreate> = {}): OrderCreate {
  return {
    internalOrderId: 'ol_order_1',
    shippingAddress: { phone: '+48 600 100 200' },
    metadata: { buyerEmail: 'buyer@example.com' },
    ...over,
  } as unknown as OrderCreate;
}

describe('ShopifyOrderContactRefresher', () => {
  it('should fill the email, phone and shipping phone the copy holds none of', async () => {
    const { refresher, mutate } = build({});

    await refresher.refresh('1', order());

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[0][1]).toEqual({
      input: { id: 'gid://shopify/Order/1', email: 'buyer@example.com', phone: '+48 600 100 200' },
    });
    expect(mutate.mock.calls[1][1]).toEqual({
      input: {
        id: 'gid://shopify/Order/1',
        shippingAddress: {
          firstName: 'Qa',
          lastName: 'IH',
          address1: 'Testowa 1',
          city: 'Warszawa',
          zip: '00-001',
          countryCode: 'PL',
          phone: '+48 600 100 200',
        },
      },
    });
    expect(mutate.mock.calls[0][2]).toBe('orderUpdate');
  });

  it('should send nothing on a repeat, once the copy carries the values', async () => {
    const { refresher, mutate } = build({
      email: 'buyer@example.com',
      phone: '+48600100200',
      shippingAddress: { ...ADDRESS, phone: '+48600100200' },
    });

    await refresher.refresh('1', order());

    expect(mutate).not.toHaveBeenCalled();
  });

  it('should leave a value an operator already set and fill only what is missing', async () => {
    const { refresher, mutate } = build({ email: 'ops@shop.example', phone: null });

    await refresher.refresh('1', order());

    const input = (mutate.mock.calls[0][1] as { input: Record<string, unknown> }).input;
    expect(input).not.toHaveProperty('email');
    expect(input).toMatchObject({ phone: '+48 600 100 200' });
    expect(input).not.toHaveProperty('shippingAddress');
  });

  it('should read nothing when the source reports no contact at all', async () => {
    const { refresher, query, mutate } = build({});

    await refresher.refresh('1', order({ shippingAddress: undefined, metadata: {} }));

    expect(query).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each([
    ['cancelled', { cancelledAt: '2026-11-01T00:00:00Z' }],
    ['closed', { closedAt: '2026-11-01T00:00:00Z' }],
  ])('should refuse a %s copy with that reason and write nothing', async (reason, current) => {
    const { refresher, mutate } = build(current);

    await expect(refresher.refresh('1', order())).rejects.toMatchObject({
      name: 'ShopifyOrderContactRefusedException',
      reason,
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('should refuse an order Shopify no longer has', async () => {
    const { refresher } = build(null);

    await expect(refresher.refresh('1', order())).rejects.toBeInstanceOf(ShopifyOrderContactRefusedException);
  });

  it('should keep the email and phone filled when Shopify refuses the shipping address, and say why', async () => {
    const { refresher, mutate } = build({});
    mutate
      .mockResolvedValueOnce({ order: { id: 'x' } })
      .mockRejectedValueOnce(
        new ShopifyUserErrorsException('orderUpdate', [
          { message: 'Country/region not supported', field: ['shippingAddress', 'country'] },
        ]),
      );

    await expect(refresher.refresh('1', order())).rejects.toThrow(/Country\/region not supported/);
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('should surface a Shopify validation error verbatim and not pre-judge the phone', async () => {
    const { refresher, mutate } = build({});
    mutate.mockRejectedValue(new ShopifyUserErrorsException('orderUpdate', [{ message: 'Phone is invalid', field: ['phone'] }]));

    await expect(refresher.refresh('1', order({ shippingAddress: { phone: 'abc' } } as Partial<OrderCreate>))).rejects.toThrow(
      /Phone is invalid/,
    );
    expect(mutate.mock.calls[0][1]).toMatchObject({ input: { phone: 'abc' } });
  });
});
