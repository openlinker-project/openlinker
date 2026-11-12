import { MasterProductNotFoundError } from '@openlinker/core/products';

import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import { ShopifyInventoryReader } from '../shopify-inventory.reader';

const LOCATION = 'gid://shopify/Location/1';
const row = (id: string): unknown => ({ id, inventoryItem: { id: `ii-${id}`, tracked: true, inventoryLevel: null } });

describe('ShopifyInventoryReader', () => {
  it('should read every variant page at the location', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        product: { id: 'gid://shopify/Product/7', status: 'ACTIVE', variants: { nodes: [row('v1')], pageInfo: { hasNextPage: true, endCursor: 'c1' } } },
      })
      .mockResolvedValueOnce({
        product: { id: 'gid://shopify/Product/7', status: 'ACTIVE', variants: { nodes: [row('v2')], pageInfo: { hasNextPage: false, endCursor: null } } },
      });

    const product = await new ShopifyInventoryReader({ query } as unknown as ShopifyGraphqlClient, 'c1').read('7', 'p', LOCATION);

    expect(product.variants.nodes.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect((query.mock.calls[1] as unknown[])[1]).toEqual({ id: 'gid://shopify/Product/7', locationId: LOCATION, after: 'c1' });
  });

  it('should read again after forget, so a write compares against the current level', async () => {
    const answer = { product: { id: 'gid://shopify/Product/7', status: 'ACTIVE', variants: { nodes: [] } } };
    const query = jest.fn().mockResolvedValue(answer);
    const reader = new ShopifyInventoryReader({ query } as unknown as ShopifyGraphqlClient, 'c1');

    await reader.read('7', 'p', LOCATION);
    await reader.read('7', 'p', LOCATION);
    reader.forget('7');
    await reader.read('7', 'p', LOCATION);

    expect(query).toHaveBeenCalledTimes(2);
  });

  it('should raise the neutral not-found error for a deleted product', async () => {
    const query = jest.fn().mockResolvedValue({ product: null });

    await expect(
      new ShopifyInventoryReader({ query } as unknown as ShopifyGraphqlClient, 'c1').read('7', 'p', LOCATION),
    ).rejects.toBeInstanceOf(MasterProductNotFoundError);
  });
});
