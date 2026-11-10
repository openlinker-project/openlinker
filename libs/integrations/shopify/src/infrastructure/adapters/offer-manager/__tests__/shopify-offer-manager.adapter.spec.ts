import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

import { ShopifyStockWriteRefusedException } from '../../../../domain/exceptions/shopify-stock-write-refused.exception';
import type { ShopifyGraphqlClient } from '../../../http/shopify-graphql-client';
import type { ShopifyShopContextProvider } from '../../../shop-context/shopify-shop-context.provider';
import { ShopifyOfferManagerAdapter } from '../shopify-offer-manager.adapter';

const LOCATION = 'gid://shopify/Location/1';

function variant(id: string, available: number | null, tracked = true, productId = '5'): Record<string, unknown> {
  return {
    __typename: 'ProductVariant',
    id: `gid://shopify/ProductVariant/${id}`,
    product: { id: `gid://shopify/Product/${productId}` },
    inventoryItem: {
      id: `gid://shopify/InventoryItem/${id}`,
      tracked,
      inventoryLevel: available === null ? null : { quantities: [{ name: 'available', quantity: available }] },
    },
  };
}

interface Harness {
  readonly adapter: ShopifyOfferManagerAdapter;
  readonly query: jest.Mock;
  readonly mutate: jest.Mock;
  readonly mapping: { getInternalId: jest.Mock; getExternalIds: jest.Mock; deleteMapping: jest.Mock };
}

function build(variantMapping: string | null = null): Harness {
  const query = jest.fn();
  const mutate = jest.fn().mockResolvedValue({ inventoryAdjustmentGroup: { changes: [] } });
  const mapping = {
    getInternalId: jest.fn().mockResolvedValue(variantMapping === null ? null : 'ol_variant_1'),
    getExternalIds: jest
      .fn()
      .mockResolvedValue(variantMapping === null ? [] : [{ connectionId: 'c1', externalId: variantMapping }]),
    deleteMapping: jest.fn().mockResolvedValue(undefined),
  };
  const adapter = new ShopifyOfferManagerAdapter(
    { query, mutate } as unknown as ShopifyGraphqlClient,
    mapping as unknown as IdentifierMappingPort,
    { get: jest.fn().mockResolvedValue({ locationGid: LOCATION }) } as unknown as ShopifyShopContextProvider,
    { id: 'c1' } as Connection,
  );
  return { adapter, query, mutate, mapping };
}

describe('ShopifyOfferManagerAdapter', () => {
  it('should set the mapped variant of a simple product with compare-and-set', async () => {
    const h = build('9');
    h.query.mockResolvedValueOnce({ nodes: [variant('9', 3)] });

    await h.adapter.updateOfferQuantity({ offerId: '5', quantity: 8, idempotencyKey: 'k1' } as never);

    const [, variables, field] = h.mutate.mock.calls[0] as [string, Record<string, unknown>, string];
    expect(field).toBe('inventorySetQuantities');
    expect(variables.input).toEqual({
      name: 'available',
      reason: 'correction',
      quantities: [
        { inventoryItemId: 'gid://shopify/InventoryItem/9', locationId: LOCATION, quantity: 8, changeFromQuantity: 3 },
      ],
    });
    expect(variables.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should resolve a variant id directly and skip a write that changes nothing', async () => {
    const h = build();
    h.query.mockResolvedValueOnce({ nodes: [variant('9', 8), null] });

    await h.adapter.updateOfferQuantity({ offerId: '9', quantity: 8 } as never);

    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('should refuse a product with several variants and no variant mapping', async () => {
    const h = build();
    h.query.mockResolvedValueOnce({
      nodes: [null, { __typename: 'Product', id: 'gid://shopify/Product/5', variants: { nodes: [variant('1', 0), variant('2', 0)] } }],
    });

    await expect(h.adapter.updateOfferQuantity({ offerId: '5', quantity: 1 } as never)).rejects.toBeInstanceOf(
      ShopifyStockWriteRefusedException,
    );
  });

  it('should refuse a variant that does not track stock', async () => {
    const h = build();
    h.query.mockResolvedValueOnce({ nodes: [variant('9', 0, false), null] });

    await expect(h.adapter.updateOfferQuantity({ offerId: '9', quantity: 1 } as never)).rejects.toThrow(/track/);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('should activate a variant not stocked at the location before setting it', async () => {
    const h = build();
    h.query.mockResolvedValueOnce({ nodes: [variant('9', null), null] });
    h.mutate.mockResolvedValueOnce({ inventoryLevel: { quantities: [{ name: 'available', quantity: 0 }] } });

    await h.adapter.updateOfferQuantity({ offerId: '9', quantity: 4 } as never);

    expect(h.mutate.mock.calls.map((call: unknown[]) => call[2])).toEqual(['inventoryActivate', 'inventorySetQuantities']);
  });

  it('should delete a mapping whose product is gone and write nothing', async () => {
    const h = build();
    h.query.mockResolvedValueOnce({ nodes: [null, null] });

    await h.adapter.updateOfferQuantity({ offerId: '5', quantity: 1 } as never);

    expect(h.mapping.deleteMapping).toHaveBeenCalledWith('ShopProduct', '5', 'c1');
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('should refuse a non-numeric id and a bad quantity before any request', async () => {
    const h = build();

    await expect(h.adapter.updateOfferQuantity({ offerId: 'abc', quantity: 1 } as never)).rejects.toBeInstanceOf(
      ShopifyStockWriteRefusedException,
    );
    await expect(h.adapter.updateOfferQuantity({ offerId: '5', quantity: -1 } as never)).rejects.toBeInstanceOf(
      ShopifyStockWriteRefusedException,
    );
    expect(h.query).not.toHaveBeenCalled();
  });
});
