import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { MasterProductNotFoundError } from '@openlinker/core/products';

import { ShopifyGraphqlError } from '../../../../domain/exceptions/shopify-graphql.error';
import { ShopifyNotMappedException } from '../../../../domain/exceptions/shopify-not-mapped.exception';
import { ShopifyNotSupportedException } from '../../../../domain/exceptions/shopify-not-supported.exception';
import type { ShopifyProduct } from '../../../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../../../http/shopify-graphql-client';
import { ShopifyProductReader } from '../../../readers/shopify-product.reader';
import type { ShopifyShopContextProvider } from '../../../shop-context/shopify-shop-context.provider';
import type { ShopifyTaxRateReader } from '../../../tax/shopify-tax-rate.reader';
import { ShopifyProductMasterAdapter } from '../shopify-product-master.adapter';

const CONNECTION = { id: 'c1' } as Connection;

function product(id: string, overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: `gid://shopify/Product/${id}`,
    title: `Product ${id}`,
    handle: `p-${id}`,
    descriptionHtml: '',
    status: 'ACTIVE',
    isGiftCard: false,
    vendor: '',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-02T00:00:00Z',
    category: null,
    media: { nodes: [] },
    variants: {
      nodes: [
        {
          id: `gid://shopify/ProductVariant/${id}1`,
          title: 'S',
          sku: `SKU-${id}`,
          barcode: null,
          price: '10.00',
          selectedOptions: [{ name: 'Size', value: 'S' }],
          inventoryItem: { id: 'ii', tracked: true },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    ...overrides,
  };
}

function mapping(): IdentifierMappingPort & { getExternalIds: jest.Mock; batchGetOrCreateInternalIds: jest.Mock } {
  return {
    getExternalIds: jest.fn().mockResolvedValue([{ connectionId: 'c1', externalId: '7' }]),
    batchGetOrCreateInternalIds: jest.fn((requests: Array<{ externalId: string; connectionId: string }>) =>
      Promise.resolve(new Map(requests.map((r) => [`${r.externalId}:${r.connectionId}`, `ol_${r.externalId}`]))),
    ),
  } as unknown as IdentifierMappingPort & { getExternalIds: jest.Mock; batchGetOrCreateInternalIds: jest.Mock };
}

const SHOP_CONTEXT = {
  get: jest.fn().mockResolvedValue({ currencyCode: 'PLN', taxesIncluded: true, shopAddress: null }),
} as unknown as ShopifyShopContextProvider;

function build(query: jest.Mock, ids = mapping(), taxes?: ShopifyTaxRateReader): ShopifyProductMasterAdapter {
  const graphql = { query } as unknown as ShopifyGraphqlClient;
  return new ShopifyProductMasterAdapter(
    graphql,
    ids,
    SHOP_CONTEXT,
    new ShopifyProductReader(graphql, 'c1'),
    taxes ?? ({ read: jest.fn() } as unknown as ShopifyTaxRateReader),
    CONNECTION,
    undefined,
  );
}

describe('ShopifyProductMasterAdapter', () => {
  it('should leave archived products and gift cards out of the catalogue enumeration', async () => {
    const query = jest.fn().mockResolvedValue({
      products: {
        nodes: [
          { id: 'gid://shopify/Product/1', status: 'ACTIVE', isGiftCard: false },
          { id: 'gid://shopify/Product/2', status: 'ARCHIVED', isGiftCard: false },
          { id: 'gid://shopify/Product/3', status: 'ACTIVE', isGiftCard: true },
          { id: 'gid://shopify/Product/4', status: 'DRAFT', isGiftCard: false },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    await expect(build(query).listExternalIds({ offset: 0, limit: 10 })).resolves.toEqual(['1', '4']);
  });

  it('should list the union of changed products and changed variants, pulled back 15 s (L-M2, A19)', async () => {
    const query = jest.fn((document: string, _variables: { query: string }) =>
      Promise.resolve(
        document.includes('productVariants')
          ? {
              productVariants: {
                nodes: [{ product: { id: 'gid://shopify/Product/10' } }, { product: { id: 'gid://shopify/Product/2' } }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            }
          : {
              products: {
                nodes: [{ id: 'gid://shopify/Product/2' }, { id: 'gid://shopify/Product/9' }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
      ),
    );

    const ids = await build(query).listExternalIdsModifiedSince({
      since: new Date('2026-11-05T10:00:15.000Z'),
      offset: 0,
      limit: 10,
    });

    expect(ids).toEqual(['2', '9', '10']);
    expect(query.mock.calls[0]?.[1].query).toBe("updated_at:>='2026-11-05T10:00:00Z' AND gift_card:false");
  });

  it('should map a product read directly by its internal id', async () => {
    const query = jest.fn().mockResolvedValue({ product: product('7') });

    await expect(build(query).getProduct('ol_7')).resolves.toMatchObject({
      id: 'ol_7',
      name: 'Product 7',
      price: 10,
      sku: 'SKU-7',
    });
  });

  it('should report a deleted product as the neutral not-found error (A10)', async () => {
    const query = jest.fn().mockResolvedValue({ product: null });

    await expect(build(query).getProductVariants('ol_7')).rejects.toBeInstanceOf(MasterProductNotFoundError);
  });

  it('should raise a mapping gap, never a deletion, for an internal id with no Shopify id', async () => {
    const ids = mapping();
    ids.getExternalIds.mockResolvedValue([]);

    await expect(build(jest.fn(), ids).getProduct('ol_x')).rejects.toBeInstanceOf(ShopifyNotMappedException);
  });

  it('should key every variant by its own Shopify id', async () => {
    const query = jest.fn().mockResolvedValue({ product: product('7') });

    await expect(build(query).getProductVariants('ol_7')).resolves.toEqual([
      expect.objectContaining({ id: 'ol_71', productId: 'ol_7', attributes: { Size: 'S' }, price: 10 }),
    ]);
  });

  it('should warm the per-product reads with one bulk read and never throw', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ nodes: [product('7'), null] })
      .mockRejectedValue(new Error('should not be called'));
    const adapter = build(query);

    await adapter.prefetchProducts(['7', '8']);
    await expect(adapter.getProduct('ol_7')).resolves.toMatchObject({ name: 'Product 7' });
    expect(query).toHaveBeenCalledTimes(1);

    await expect(adapter.prefetchProducts(['9'])).resolves.toBeUndefined();
  });

  it('should ask the tax reader for the first variant of the product', async () => {
    const taxes = { read: jest.fn().mockResolvedValue({ kind: 'resolved', code: '23', countryIso2: 'PL' }) };
    const query = jest.fn().mockResolvedValue({ product: product('7') });

    await expect(
      build(query, mapping(), taxes as unknown as ShopifyTaxRateReader).readProductTaxRate({ productId: 'ol_7' }),
    ).resolves.toMatchObject({ code: '23' });
    expect(taxes.read).toHaveBeenCalledWith({ variantId: 'gid://shopify/ProductVariant/71' });
  });

  it('should refuse product writes', async () => {
    await expect(build(jest.fn()).deleteProduct('ol_7')).rejects.toBeInstanceOf(ShopifyNotSupportedException);
  });

  it('should list the shop category directory without the gift cards categories', async () => {
    const mugs = {
      id: 'gid://shopify/TaxonomyCategory/hg-1',
      name: 'Mugs',
      fullName: 'Home > Mugs',
      ancestorIds: ['gid://shopify/TaxonomyCategory/hg'],
    };
    const giftCards = {
      id: 'gid://shopify/TaxonomyCategory/gc-1',
      name: 'Gift Cards',
      fullName: 'Gifts > Gift Cards',
      ancestorIds: ['gid://shopify/TaxonomyCategory/gc'],
    };
    const query = jest.fn().mockResolvedValue({
      products: {
        nodes: [
          { isGiftCard: false, category: mugs },
          { isGiftCard: true, category: giftCards },
          { isGiftCard: false, category: null },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const directory = await build(query).getCategories();

    expect(directory.map((c) => c.id)).toEqual(['hg', 'hg-1']);
  });

  it('should leave archived products out of a read by external ids', async () => {
    const query = jest.fn().mockResolvedValue({ nodes: [product('1'), product('2', { status: 'ARCHIVED' }), null] });

    const products = await build(query).getProducts({ externalIds: ['1', '2', '3'] });

    expect(products.map((p) => p.id)).toEqual(['ol_1']);
  });

  it('should search by title and leave gift cards and archived products out', async () => {
    const query = jest.fn().mockResolvedValue({
      products: {
        nodes: [product('1'), product('2', { isGiftCard: true }), product('3', { status: 'ARCHIVED' })],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const products = await build(query).searchProducts('mug "x"');

    expect(products.map((p) => p.id)).toEqual(['ol_1']);
    expect((query.mock.calls[0] as unknown[])[1]).toMatchObject({ query: 'title:*mug x*' });
  });

  it('should halve the bulk batch when Shopify refuses its cost, and still read every product', async () => {
    const tooExpensive = new ShopifyGraphqlError(['MAX_COST_EXCEEDED'], ['Query cost exceeds 1000']);
    const query = jest.fn((_document: string, variables: { ids: string[] }) =>
      variables.ids.length > 5
        ? Promise.reject(tooExpensive)
        : Promise.resolve({ nodes: variables.ids.map((gid) => product(gid.split('/').pop() ?? '')) }),
    );
    const ids = Array.from({ length: 12 }, (_, i) => String(i + 1));

    const products = await build(query).getProducts({ externalIds: ids });

    expect(products).toHaveLength(12);
    expect(query.mock.calls.map((call) => call[1].ids.length)).toEqual([10, 5, 5, 2]);
  });
});
