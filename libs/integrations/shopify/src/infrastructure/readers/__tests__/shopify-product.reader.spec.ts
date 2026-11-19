import { MasterProductNotFoundError } from '@openlinker/core/products';

import { ShopifyApiError } from '../../../domain/exceptions/shopify-api.error';
import type { ShopifyProduct, ShopifyVariant } from '../../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import { ShopifyProductReader } from '../shopify-product.reader';

function product(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 'gid://shopify/Product/7',
    title: 'Mug',
    handle: 'mug',
    descriptionHtml: '',
    status: 'ACTIVE',
    isGiftCard: false,
    vendor: '',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    category: null,
    media: { nodes: [] },
    variants: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    ...overrides,
  };
}

const variant = (id: string): ShopifyVariant => ({
  id,
  title: id,
  sku: null,
  barcode: null,
  price: '1.00',
  selectedOptions: [],
  inventoryItem: { id: `ii-${id}`, tracked: true },
});

function client(...answers: unknown[]): ShopifyGraphqlClient & { query: jest.Mock } {
  const query = jest.fn();
  for (const answer of answers) {
    query.mockResolvedValueOnce(answer);
  }
  return { query } as unknown as ShopifyGraphqlClient & { query: jest.Mock };
}

describe('ShopifyProductReader', () => {
  it('should raise the neutral not-found error when Shopify answers no product (A10)', async () => {
    const reader = new ShopifyProductReader(client({ product: null }), 'c1');

    await expect(reader.read('7', 'ol_product_1')).rejects.toBeInstanceOf(MasterProductNotFoundError);
  });

  it('should treat an ARCHIVED product as removed from sale, but sync a DRAFT one (A11)', async () => {
    const archived = new ShopifyProductReader(client({ product: product({ status: 'ARCHIVED' }) }), 'c1');
    const draft = new ShopifyProductReader(client({ product: product({ status: 'DRAFT' }) }), 'c1');

    await expect(archived.read('7', 'p')).rejects.toBeInstanceOf(MasterProductNotFoundError);
    await expect(draft.read('7', 'p')).resolves.toMatchObject({ status: 'DRAFT' });
  });

  it('should pass a transport failure through untouched, never as a deletion', async () => {
    const graphql = { query: jest.fn().mockRejectedValue(new ShopifyApiError(503)) } as unknown as ShopifyGraphqlClient;

    await expect(new ShopifyProductReader(graphql, 'c1').read('7', 'p')).rejects.toBeInstanceOf(ShopifyApiError);
  });

  it('should read the variants past the first page so every variant is synced', async () => {
    const graphql = client(
      {
        product: product({
          variants: { nodes: [variant('v1')], pageInfo: { hasNextPage: true, endCursor: 'c1' } },
        }),
      },
      {
        product: { variants: { nodes: [variant('v2')], pageInfo: { hasNextPage: true, endCursor: 'c2' } } },
      },
      {
        product: { variants: { nodes: [variant('v3')], pageInfo: { hasNextPage: false, endCursor: null } } },
      },
    );

    const read = await new ShopifyProductReader(graphql, 'c1').read('7', 'p');

    expect(read.variants.nodes.map((v) => v.id)).toEqual(['v1', 'v2', 'v3']);
    expect((graphql.query.mock.calls[1] as unknown[])[1]).toEqual({ id: 'gid://shopify/Product/7', after: 'c1' });
  });

  it('should serve a seeded product without reading it again', async () => {
    const graphql = client();
    const reader = new ShopifyProductReader(graphql, 'c1');
    reader.seed('7', product());

    await expect(reader.read('7', 'p')).resolves.toMatchObject({ id: 'gid://shopify/Product/7' });
    expect(graphql.query).not.toHaveBeenCalled();
  });
});
