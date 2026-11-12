import type { CachePort } from '@openlinker/shared';

import { ShopifyApiError } from '../../../domain/exceptions/shopify-api.error';
import { ShopifyGraphqlError } from '../../../domain/exceptions/shopify-graphql.error';
import { ShopifyUserErrorsException } from '../../../domain/exceptions/shopify-user-errors.exception';
import type { ShopifyShopAddress, ShopifyTaxLine } from '../../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import type { ShopifyShopContextProvider } from '../../shop-context/shopify-shop-context.provider';
import { ShopifyTaxRateReader, shopifyRateCode } from '../shopify-tax-rate.reader';

const PL_SHOP: ShopifyShopAddress = { countryCodeV2: 'PL', provinceCode: null, zip: '00-001' };
const READ = { variantId: 'gid://shopify/ProductVariant/11' };

function shopContext(shopAddress: ShopifyShopAddress | null = PL_SHOP): ShopifyShopContextProvider {
  return { get: jest.fn().mockResolvedValue({ shopAddress }) } as unknown as ShopifyShopContextProvider;
}

function calculated(taxLines: ShopifyTaxLine[], taxable = true): Record<string, unknown> {
  return { calculatedDraftOrder: { taxesIncluded: true, taxLines, lineItems: [{ taxable }] } };
}

function client(answer: unknown): ShopifyGraphqlClient & { mutate: jest.Mock } {
  const mutate =
    answer instanceof Error ? jest.fn().mockRejectedValue(answer) : jest.fn().mockResolvedValue(answer);
  return { mutate } as unknown as ShopifyGraphqlClient & { mutate: jest.Mock };
}

function reader(
  graphql: ShopifyGraphqlClient,
  country: string | null = null,
  shop = shopContext(),
  cache?: CachePort,
): ShopifyTaxRateReader {
  return new ShopifyTaxRateReader(graphql, shop, 'c1', country, cache);
}

describe('ShopifyTaxRateReader', () => {
  it('should state the rate Shopify computes for one variant shipped to the shop country (L-T4)', async () => {
    const graphql = client(calculated([{ title: 'VAT', rate: 0.23, ratePercentage: 23 }]));

    await expect(reader(graphql).read(READ)).resolves.toEqual({ kind: 'resolved', code: '23', countryIso2: 'PL' });
    const [, variables, payloadField] = graphql.mutate.mock.calls[0];
    expect(payloadField).toBe('draftOrderCalculate');
    expect(variables).toEqual({
      input: {
        lineItems: [{ variantId: 'gid://shopify/ProductVariant/11', quantity: 1 }],
        shippingAddress: { countryCode: 'PL', zip: '00-001' },
      },
    });
  });

  it('should send only the country when the sales country is not the shop own', async () => {
    const graphql = client(calculated([{ title: 'MwSt', rate: 0.19, ratePercentage: 19 }]));

    await expect(reader(graphql, 'DE').read(READ)).resolves.toMatchObject({ code: '19', countryIso2: 'DE' });
    const variables = (graphql.mutate.mock.calls[0] as unknown[])[1] as {
      input: { shippingAddress: Record<string, string> };
    };
    expect(variables.input.shippingAddress).toEqual({ countryCode: 'DE' });
  });

  it('should read a non-taxable variant as the shop own zero rate', async () => {
    await expect(reader(client(calculated([], false))).read(READ)).resolves.toEqual({
      kind: 'resolved',
      code: '0',
      countryIso2: 'PL',
    });
  });

  it('should report not-configured, never zero, when a taxable variant gets no tax line', async () => {
    await expect(reader(client(calculated([]))).read(READ)).resolves.toMatchObject({
      kind: 'unknown',
      reason: 'not-configured',
    });
  });

  it('should report several tax lines as ambiguous', async () => {
    const lines = [
      { title: 'NY State', rate: 0.04, ratePercentage: 4 },
      { title: 'NYC', rate: 0.045, ratePercentage: 4.5 },
    ];

    await expect(reader(client(calculated(lines))).read(READ)).resolves.toMatchObject({
      kind: 'unknown',
      reason: 'ambiguous',
    });
  });

  it('should answer unreadable when Shopify refuses the calculation', async () => {
    const refused = new ShopifyUserErrorsException('draftOrderCalculate', [{ message: 'Variant not found' }]);

    await expect(reader(client(refused)).read(READ)).resolves.toMatchObject({ kind: 'unknown', reason: 'unreadable' });
  });

  it('should throw a transport failure so the next sync asks again', async () => {
    await expect(reader(client(new ShopifyApiError(503))).read(READ)).rejects.toBeInstanceOf(ShopifyApiError);
  });

  it('should report not-configured with no sales country and no shop address', async () => {
    const graphql = client(calculated([]));

    await expect(reader(graphql, null, shopContext(null)).read(READ)).resolves.toMatchObject({
      kind: 'unknown',
      reason: 'not-configured',
    });
    expect(graphql.mutate).not.toHaveBeenCalled();
  });

  it('should answer unreadable, not throw, when the app lacks the optional scope', async () => {
    const denied = new ShopifyGraphqlError(['ACCESS_DENIED'], ['Access denied for draftOrderCalculate field.']);

    await expect(reader(client(denied)).read(READ)).resolves.toMatchObject({
      kind: 'unknown',
      reason: 'unreadable',
    });
  });

  it('should serve a cached answer for the same variant and country, whatever moved on the product', async () => {
    const store = new Map<string, unknown>();
    const cache = {
      get: jest.fn((k: string) => Promise.resolve((store.get(k) ?? null) as never)),
      set: jest.fn((k: string, v: unknown) => {
        store.set(k, v);
        return Promise.resolve();
      }),
      delete: jest.fn(),
    } as unknown as CachePort;
    const graphql = client(calculated([{ title: 'VAT', rate: 0.08, ratePercentage: 8 }]));
    const taxes = reader(graphql, null, shopContext(), cache);

    await taxes.read(READ);
    await taxes.read(READ);
    await taxes.read({ variantId: 'gid://shopify/ProductVariant/12' });

    expect(graphql.mutate).toHaveBeenCalledTimes(2);
  });

  it('should keep an unknown answer for minutes, not a day, so a finished tax setup shows on the next sync', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(),
    } as unknown as CachePort & { set: jest.Mock };

    await reader(client(calculated([])), null, shopContext(), cache).read(READ);
    await reader(client(calculated([{ title: 'VAT', rate: 0.23, ratePercentage: 23 }])), null, shopContext(), cache).read(READ);

    expect(cache.set).toHaveBeenNthCalledWith(1, expect.any(String), expect.anything(), 900);
    expect(cache.set).toHaveBeenNthCalledWith(2, expect.any(String), expect.anything(), 86_400);
  });

  it.each([
    [{ title: 'x', rate: 0.23, ratePercentage: 23 }, '23'],
    [{ title: 'x', rate: 0.055, ratePercentage: null }, '5.5'],
    [{ title: 'x', rate: null, ratePercentage: null }, null],
  ])('should turn the tax line %p into the code %p', (line, code) => {
    expect(shopifyRateCode(line)).toBe(code);
  });
});
