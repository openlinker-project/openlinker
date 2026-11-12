import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { CachePort } from '@openlinker/shared';

import { ShopifyNotSupportedException } from '../../../../domain/exceptions/shopify-not-supported.exception';
import { ShopifyUserErrorsException } from '../../../../domain/exceptions/shopify-user-errors.exception';
import type { ShopifyInventoryVariant } from '../../../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../../../http/shopify-graphql-client';
import { ShopifyInventoryReader } from '../../../readers/shopify-inventory.reader';
import type { ShopifyShopContextProvider } from '../../../shop-context/shopify-shop-context.provider';
import { ShopifyInventoryMasterAdapter } from '../shopify-inventory-master.adapter';

const LOCATION = 'gid://shopify/Location/1';

function variant(id: string, available: number | null, tracked = true): ShopifyInventoryVariant {
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    inventoryItem: {
      id: `gid://shopify/InventoryItem/${id}`,
      tracked,
      inventoryLevel:
        available === null
          ? null
          : {
              updatedAt: '2026-11-04T10:00:00Z',
              quantities: [
                { name: 'available', quantity: available },
                { name: 'on_hand', quantity: available + 2 },
                { name: 'committed', quantity: 2 },
              ],
            },
    },
  };
}

function productAnswer(variants: ShopifyInventoryVariant[], status = 'ACTIVE'): unknown {
  return {
    product: {
      id: 'gid://shopify/Product/7',
      status,
      variants: { nodes: variants, pageInfo: { hasNextPage: false, endCursor: null } },
    },
  };
}

function mapping(): IdentifierMappingPort {
  return {
    getExternalIds: jest.fn((entityType: string, internalId: string) =>
      Promise.resolve(
        entityType === 'ProductVariant'
          ? [{ connectionId: 'c1', externalId: internalId.replace('ol_v', '') }]
          : [{ connectionId: 'c1', externalId: '7' }],
      ),
    ),
    batchGetOrCreateInternalIds: jest.fn((requests: Array<{ externalId: string; connectionId: string }>) =>
      Promise.resolve(new Map(requests.map((r) => [`${r.externalId}:${r.connectionId}`, `ol_${r.externalId}`]))),
    ),
  } as unknown as IdentifierMappingPort;
}

function memoryCache(): CachePort {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn((k: string) => Promise.resolve((store.get(k) ?? null) as never)),
    set: jest.fn((k: string, v: unknown) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    delete: jest.fn(),
  } as unknown as CachePort;
}

interface Fakes {
  query: jest.Mock;
  mutate: jest.Mock;
}

function build(fakes: Fakes, cache?: CachePort, unmanaged: number | null = null): ShopifyInventoryMasterAdapter {
  const client = fakes as unknown as ShopifyGraphqlClient;
  return new ShopifyInventoryMasterAdapter(
    client,
    mapping(),
    { get: jest.fn().mockResolvedValue({ locationGid: LOCATION }) } as unknown as ShopifyShopContextProvider,
    new ShopifyInventoryReader(client, 'c1'),
    { id: 'c1' } as Connection,
    unmanaged,
    cache,
  );
}

const adjusted = (createdAt = '2026-11-04T22:07:21Z', after = 6): unknown => ({
  inventoryAdjustmentGroup: { createdAt, changes: [{ name: 'available', quantityAfterChange: after }] },
});

const stale = new ShopifyUserErrorsException('inventoryAdjustQuantities', [
  { message: 'The changeFromQuantity argument no longer matches', code: 'CHANGE_FROM_QUANTITY_STALE' },
]);

describe('ShopifyInventoryMasterAdapter', () => {
  describe('reads', () => {
    it('should report each variant at the configured location, pooled, with committed as reserved', async () => {
      const query = jest.fn().mockResolvedValue(productAnswer([variant('1', 4), variant('2', null)]));

      const rows = await build({ query, mutate: jest.fn() }).listInventory('ol_7');

      expect(rows).toEqual([
        expect.objectContaining({ variantId: 'ol_1', available: 4, quantity: 6, reserved: 2, locationId: undefined }),
        expect.objectContaining({ variantId: 'ol_2', available: 0, quantity: 0, reserved: 0 }),
      ]);
      expect((query.mock.calls[0] as unknown[])[1]).toMatchObject({ locationId: LOCATION });
    });

    it('should report an untracked variant at the unmanaged cap, 1000 by default (L-I1)', async () => {
      const query = jest.fn().mockResolvedValue(productAnswer([variant('1', null, false)]));

      await expect(build({ query, mutate: jest.fn() }).listInventory('ol_7')).resolves.toEqual([
        expect.objectContaining({ available: 1000 }),
      ]);
      await expect(build({ query, mutate: jest.fn() }, undefined, 25).listInventory('ol_7')).resolves.toEqual([
        expect.objectContaining({ available: 25 }),
      ]);
    });

    it('should raise the neutral not-found error for a deleted or archived product', async () => {
      const deleted = jest.fn().mockResolvedValue({ product: null });
      const archived = jest.fn().mockResolvedValue(productAnswer([variant('1', 1)], 'ARCHIVED'));

      await expect(build({ query: deleted, mutate: jest.fn() }).listInventory('ol_7')).rejects.toBeInstanceOf(
        MasterProductNotFoundError,
      );
      await expect(build({ query: archived, mutate: jest.fn() }).listInventory('ol_7')).rejects.toBeInstanceOf(
        MasterProductNotFoundError,
      );
    });

    it('should warm a batch with one bulk read and never throw', async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ nodes: [{ id: 'gid://shopify/Product/7', status: 'ACTIVE', variants: { nodes: [variant('1', 3)] } }] })
        .mockRejectedValue(new Error('should not be read again'));
      const adapter = build({ query, mutate: jest.fn() });

      await adapter.prefetchInventory(['ol_7']);
      await expect(adapter.listInventory('ol_7')).resolves.toEqual([expect.objectContaining({ available: 3 })]);
      await expect(adapter.prefetchInventory(['ol_8'])).resolves.toBeUndefined();
    });
  });

  describe('adjustInventory', () => {
    it('should write a compare-and-set delta on available with Shopify own instant as appliedAt', async () => {
      const query = jest.fn().mockResolvedValue(productAnswer([variant('1', 4)]));
      const mutate = jest.fn().mockResolvedValue(adjusted());

      const result = await build({ query, mutate }).adjustInventory({
        productId: 'ol_7',
        quantity: 2,
        reason: 'manual_correction',
        idempotencyKey: 'manual:m1',
      });

      expect(result).toMatchObject({ available: 6 });
      expect(result.adjustmentOutcome).toEqual({
        disposition: 'applied',
        idempotency: 'unsupported',
        appliedAt: new Date('2026-11-04T22:07:21Z'),
      });
      const variables = (mutate.mock.calls[0] as unknown[])[1] as {
        key: string;
        input: { name: string; reason: string; changes: Array<Record<string, unknown>> };
      };
      expect(variables.input).toMatchObject({ name: 'available', reason: 'correction' });
      expect(variables.input.changes[0]).toEqual({
        inventoryItemId: 'gid://shopify/InventoryItem/1',
        locationId: LOCATION,
        delta: 2,
        changeFromQuantity: 4,
      });
      expect(variables.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should apply a correction once and answer a replay of the key as deduplicated (A18)', async () => {
      const query = jest.fn().mockResolvedValue(productAnswer([variant('1', 4)]));
      const mutate = jest.fn().mockResolvedValue(adjusted());
      const cache = memoryCache();
      const adjustment = { productId: 'ol_7', quantity: 2, idempotencyKey: 'manual:m1' };

      await build({ query, mutate }, cache).adjustInventory(adjustment);
      const replay = await build({ query, mutate }, cache).adjustInventory(adjustment);

      expect(mutate).toHaveBeenCalledTimes(1);
      expect(replay.adjustmentOutcome).toEqual({
        disposition: 'deduplicated',
        idempotency: 'honoured',
        appliedAt: new Date('2026-11-04T22:07:21Z'),
      });
    });

    it('should re-read and retry when the level moved since it was read, never overwriting it (G05)', async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce(productAnswer([variant('1', 4)]))
        .mockResolvedValueOnce(productAnswer([variant('1', 7)]));
      const mutate = jest.fn().mockRejectedValueOnce(stale).mockResolvedValueOnce(adjusted(undefined, 9));

      const result = await build({ query, mutate }).adjustInventory({
        productId: 'ol_7',
        quantity: 2,
        idempotencyKey: 'sale:k',
      });

      expect(result.available).toBe(9);
      const first = (mutate.mock.calls[0] as unknown[])[1] as { key: string; input: { changes: Array<{ changeFromQuantity: number }> } };
      const second = (mutate.mock.calls[1] as unknown[])[1] as { key: string; input: { changes: Array<{ changeFromQuantity: number }> } };
      expect(first.input.changes[0].changeFromQuantity).toBe(4);
      expect(second.input.changes[0].changeFromQuantity).toBe(7);
      expect(second.key).not.toBe(first.key);
    });

    it('should give up after three stale attempts and let the error out', async () => {
      const query = jest.fn().mockResolvedValue(productAnswer([variant('1', 4)]));
      const mutate = jest.fn().mockRejectedValue(stale);

      await expect(
        build({ query, mutate }).adjustInventory({ productId: 'ol_7', quantity: 1 }),
      ).rejects.toBe(stale);
      expect(mutate).toHaveBeenCalledTimes(3);
    });

    it('should clamp a removal past zero to zero', async () => {
      const query = jest.fn().mockResolvedValue(productAnswer([variant('1', 3)]));
      const mutate = jest.fn().mockResolvedValue(adjusted(undefined, 0));

      await build({ query, mutate }).adjustInventory({ productId: 'ol_7', quantity: -5 });

      expect(((mutate.mock.calls[0] as unknown[])[1] as { input: { changes: Array<{ delta: number }> } }).input.changes[0].delta).toBe(-3);
    });

    it.each([
      ['an untracked variant', [variant('1', null, false)], undefined],
      ['a variant not stocked at the location', [variant('1', null)], undefined],
      ['a product with several variants and none named', [variant('1', 1), variant('2', 1)], undefined],
      ['a variant that is not the product own', [variant('1', 1)], 'ol_v9'],
    ])('should refuse %s as not supported, writing nothing', async (_label, variants, variantId) => {
      const query = jest.fn().mockResolvedValue(productAnswer(variants));
      const mutate = jest.fn();

      await expect(
        build({ query, mutate }).adjustInventory({ productId: 'ol_7', quantity: 1, variantId }),
      ).rejects.toBeInstanceOf(ShopifyNotSupportedException);
      expect(mutate).not.toHaveBeenCalled();
    });

    it('should use the restock reason for a return restock', async () => {
      const query = jest.fn().mockResolvedValue(productAnswer([variant('1', 4)]));
      const mutate = jest.fn().mockResolvedValue(adjusted());

      await build({ query, mutate }).adjustInventory({ productId: 'ol_7', quantity: 1, reason: 'return_restock' });

      expect(((mutate.mock.calls[0] as unknown[])[1] as { input: { reason: string } }).input.reason).toBe('restock');
    });
  });
});
