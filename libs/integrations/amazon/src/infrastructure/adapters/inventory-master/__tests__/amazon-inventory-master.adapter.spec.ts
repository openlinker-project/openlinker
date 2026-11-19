/**
 * AmazonInventoryMasterAdapter tests (#4183)
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/inventory-master/__tests__
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { isBulkInventoryReader } from '@openlinker/core/inventory';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import { InMemoryCacheAdapter } from '@openlinker/shared/cache/testing';

import { AmazonApiError } from '../../../../domain/exceptions/amazon-api.error';
import { AmazonConfigException } from '../../../../domain/exceptions/amazon-config.exception';
import { AmazonNotSupportedException } from '../../../../domain/exceptions/amazon-not-supported.exception';
import { AmazonStockUnreadableException } from '../../../../domain/exceptions/amazon-stock-unreadable.exception';
import type { AmazonConnectionConfig } from '../../../../domain/types/amazon-config.types';
import type { AmazonListingItem } from '../../../../domain/types/amazon-listing.types';
import type { AmazonSpApiClient } from '../../../http/amazon-spapi-client';
import { AmazonInventoryMasterAdapter } from '../amazon-inventory-master.adapter';

const DE = 'A1PA6795UKMFR9';
const SELLER = 'A2SELLER123';
const BASE_CONFIG: AmazonConnectionConfig = {
  region: 'eu',
  environment: 'production',
  marketplaceIds: [DE],
  sellerId: SELLER,
};
const FBA_CONFIG: AmazonConnectionConfig = { ...BASE_CONFIG, fbaLocationId: 'ol_location_fba' };

const listing = (sku: string, quantity: number | undefined | null, extra: Partial<AmazonListingItem> = {}): AmazonListingItem => ({
  sku,
  summaries: [{ marketplaceId: DE, asin: `B0${sku}`, productType: 'KITCHEN', status: ['BUYABLE'] }],
  ...(quantity === null ? {} : { fulfillmentAvailability: [{ fulfillmentChannelCode: 'DEFAULT', quantity }] }),
  ...extra,
});
const parent = (sku: string, children: string[]): AmazonListingItem =>
  listing(sku, null, {
    relationships: [{ marketplaceId: DE, relationships: [{ type: 'VARIATION', childSkus: children }] }],
  });

const ok = (data: unknown): { status: number; requestId: string; data: unknown } => ({ status: 200, requestId: 'r', data });

interface Setup {
  adapter: AmazonInventoryMasterAdapter;
  get: jest.Mock;
  patch: jest.Mock;
  identifierMapping: jest.Mocked<IdentifierMappingPort>;
  cache: InMemoryCacheAdapter;
}

function setup(options: {
  listings: AmazonListingItem[];
  fba?: Array<{ sellerSku: string; fulfillable: number; reserved: number }>;
  config?: AmazonConnectionConfig;
  stockLocationOverride?: string;
  skuByInternalId?: Record<string, string>;
  withCache?: boolean;
}): Setup {
  const bySku = new Map(options.listings.map((item) => [item.sku, item]));
  const get = jest.fn((path: string, query: Record<string, unknown>) => {
    if (path === '/fba/inventory/v1/summaries') {
      const skus = query.sellerSkus as string[];
      return Promise.resolve(
        ok({
          payload: {
            inventorySummaries: (options.fba ?? [])
              .filter((entry) => skus.includes(entry.sellerSku))
              .map((entry) => ({
                sellerSku: entry.sellerSku,
                inventoryDetails: {
                  fulfillableQuantity: entry.fulfillable,
                  reservedQuantity: { totalReservedQuantity: entry.reserved },
                },
              })),
          },
        }),
      );
    }
    const prefix = `/listings/2021-08-01/items/${SELLER}`;
    if (path === prefix) {
      const skus = query.identifiers as string[];
      return Promise.resolve(ok({ numberOfResults: 0, items: skus.flatMap((sku) => bySku.get(sku) ?? []) }));
    }
    const sku = decodeURIComponent(path.slice(prefix.length + 1));
    const item = bySku.get(sku);
    return item ? Promise.resolve(ok(item)) : Promise.reject(new AmazonApiError(404, 'NOT_FOUND', 'gone', 'r'));
  });
  const patch = jest.fn().mockResolvedValue(ok({ sku: 'x', status: 'ACCEPTED', submissionId: 's' }));
  const mapped = options.skuByInternalId ?? { ol_product_1: 'MUG' };
  const identifierMapping = {
    getExternalIds: jest.fn((_type: string, id: string) =>
      Promise.resolve(mapped[id] ? [{ externalId: mapped[id], connectionId: 'conn-amz' }] : []),
    ),
    batchGetOrCreateInternalIds: jest.fn((requests: Array<{ externalId: string; entityType: string }>) =>
      Promise.resolve(
        new Map(requests.map((r) => [`${r.externalId}:conn-amz`, `ol_${r.entityType.toLowerCase()}_${r.externalId}`])),
      ),
    ),
  } as unknown as jest.Mocked<IdentifierMappingPort>;
  const cache = new InMemoryCacheAdapter();
  const connection = {
    id: 'conn-amz',
    config: options.stockLocationOverride ? { stockLocationOverride: options.stockLocationOverride } : {},
  } as unknown as Connection;
  const adapter = new AmazonInventoryMasterAdapter(
    connection,
    { get, patch } as unknown as AmazonSpApiClient,
    options.config ?? BASE_CONFIG,
    identifierMapping,
    options.withCache === false ? undefined : cache,
  );
  return { adapter, get, patch, identifierMapping, cache };
}

describe('AmazonInventoryMasterAdapter', () => {
  it('should require the merchant token', () => {
    expect(
      () =>
        new AmazonInventoryMasterAdapter(
          { id: 'c', config: {} } as unknown as Connection,
          {} as AmazonSpApiClient,
          { ...BASE_CONFIG, sellerId: undefined },
          {} as IdentifierMappingPort,
        ),
    ).toThrow(AmazonConfigException);
  });

  it('should declare the bulk read rung', () => {
    expect(isBulkInventoryReader(setup({ listings: [] }).adapter)).toBe(true);
  });

  it('should read stock on the catalogue marketplace, not the first configured one', async () => {
    const PL = 'A1C3SOZRARQ6R3';
    const { adapter, get } = setup({
      listings: [listing('MUG', 4)],
      config: { ...BASE_CONFIG, marketplaceIds: [DE, PL], catalogueMarketplaceId: PL },
    });

    await adapter.listInventory('ol_product_1');

    const [, query] = (get.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0];
    expect(query.marketplaceIds).toEqual([PL]);
  });

  describe('listInventory', () => {
    it('should report the seller-fulfilled quantity of a standalone listing without a location', async () => {
      const { adapter } = setup({ listings: [listing('MUG', 7)] });

      await expect(adapter.listInventory('ol_product_1')).resolves.toEqual([
        {
          id: 'ol_inventory_fbm:MUG',
          productId: 'ol_product_1',
          variantId: 'ol_productvariant_MUG',
          quantity: 7,
          reserved: 0,
          available: 7,
        },
      ]);
    });

    it('should report one position per variation child', async () => {
      const { adapter } = setup({
        listings: [parent('MUG', ['MUG-RED', 'MUG-BLUE']), listing('MUG-RED', 2), listing('MUG-BLUE', 0)],
      });

      const result = await adapter.listInventory('ol_product_1');

      expect(result.map((entry) => [entry.variantId, entry.available])).toEqual([
        ['ol_productvariant_MUG-BLUE', 0],
        ['ol_productvariant_MUG-RED', 2],
      ]);
    });

    it('should report zero for a listing with no seller-fulfilled channel', async () => {
      const { adapter } = setup({
        listings: [listing('MUG', null, { fulfillmentAvailability: [{ fulfillmentChannelCode: 'AMAZON_EU', quantity: 9 }] })],
      });

      const [entry] = await adapter.listInventory('ol_product_1');

      expect(entry.available).toBe(0);
    });

    it('should refuse an unreadable seller-fulfilled quantity rather than report zero', async () => {
      const { adapter } = setup({ listings: [listing('MUG', undefined)] });

      await expect(adapter.listInventory('ol_product_1')).rejects.toThrow(AmazonStockUnreadableException);
    });

    it('should report a deleted listing as a master-side deletion', async () => {
      const { adapter } = setup({ listings: [] });

      await expect(adapter.listInventory('ol_product_1')).rejects.toThrow(MasterProductNotFoundError);
    });

    it('should report a missing mapping as a retryable gap, not a deletion', async () => {
      const { adapter } = setup({ listings: [listing('MUG', 1)], skuByInternalId: {} });

      const error = await adapter.listInventory('ol_product_1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(MasterProductNotFoundError);
    });

    it('should refuse a parent none of whose children can be read', async () => {
      const { adapter } = setup({ listings: [parent('MUG', ['MUG-RED'])] });

      await expect(adapter.listInventory('ol_product_1')).rejects.toThrow(/none could be read/);
    });

    it('should report FBA stock at the FBA location, for every variant', async () => {
      const { adapter } = setup({
        listings: [parent('MUG', ['MUG-RED', 'MUG-BLUE']), listing('MUG-RED', 2), listing('MUG-BLUE', 1)],
        fba: [{ sellerSku: 'MUG-RED', fulfillable: 5, reserved: 1 }],
        config: FBA_CONFIG,
        stockLocationOverride: 'ol_location_main',
      });

      const result = await adapter.listInventory('ol_product_1');
      const fba = result.filter((entry) => entry.locationId === 'ol_location_fba');

      expect(fba).toEqual([
        expect.objectContaining({ variantId: 'ol_productvariant_MUG-BLUE', available: 0, reserved: 0, quantity: 0 }),
        expect.objectContaining({ variantId: 'ol_productvariant_MUG-RED', available: 5, reserved: 1, quantity: 6 }),
      ]);
      expect(result.filter((entry) => entry.locationId === undefined)).toHaveLength(2);
    });

    it('should not read FBA without a separate seller-fulfilled location', async () => {
      const { adapter, get } = setup({ listings: [listing('MUG', 3)], config: FBA_CONFIG });

      const result = await adapter.listInventory('ol_product_1');

      expect(result).toHaveLength(1);
      expect((get.mock.calls as unknown[][]).some((call) => call[0] === '/fba/inventory/v1/summaries')).toBe(false);
    });

    it('should fail the sync when the FBA read fails, instead of dropping FBA rows', async () => {
      const { adapter, get } = setup({
        listings: [listing('MUG', 3)],
        config: FBA_CONFIG,
        stockLocationOverride: 'ol_location_main',
      });
      const original = get.getMockImplementation() as unknown as (path: string, query: Record<string, unknown>) => Promise<unknown>;
      get.mockImplementation((path: string, query: Record<string, unknown>) =>
        path === '/fba/inventory/v1/summaries'
          ? Promise.reject(new AmazonApiError(500, 'InternalFailure', 'down', 'r'))
          : original(path, query),
      );

      await expect(adapter.listInventory('ol_product_1')).rejects.toThrow(AmazonApiError);
    });
  });

  describe('prefetchInventory', () => {
    it('should serve the following reads from the warm copy', async () => {
      const { adapter, get } = setup({
        listings: [parent('MUG', ['MUG-RED']), listing('MUG-RED', 4)],
      });

      await adapter.prefetchInventory(['ol_product_1']);
      const calls = get.mock.calls.length;
      await adapter.listInventory('ol_product_1');

      expect(get.mock.calls.length).toBe(calls);
    });

    it('should swallow a failure so the per-product reads still run', async () => {
      const { adapter, get } = setup({ listings: [listing('MUG', 1)] });
      get.mockRejectedValueOnce(new Error('network'));

      await expect(adapter.prefetchInventory(['ol_product_1'])).resolves.toBeUndefined();
    });
  });

  describe('adjustInventory', () => {
    it('should write the new seller-fulfilled quantity from a fresh read', async () => {
      const { adapter, patch } = setup({ listings: [listing('MUG', 5)] });

      const result = await adapter.adjustInventory({ productId: 'ol_product_1', quantity: -2, reason: 'manual_correction' });

      expect(patch).toHaveBeenCalledWith(
        `/listings/2021-08-01/items/${SELLER}/MUG`,
        {
          productType: 'KITCHEN',
          patches: [
            {
              op: 'replace',
              path: '/attributes/fulfillment_availability',
              value: [{ fulfillment_channel_code: 'DEFAULT', quantity: 3 }],
            },
          ],
        },
        { marketplaceIds: [DE] },
      );
      expect(result).toEqual(
        expect.objectContaining({
          available: 3,
          variantId: 'ol_productvariant_MUG',
          adjustmentOutcome: { disposition: 'applied', idempotency: 'not_requested', appliedAt: null },
        }),
      );
    });

    it('should clamp a decrease below zero', async () => {
      const { adapter } = setup({ listings: [listing('MUG', 1)] });

      const result = await adapter.adjustInventory({ productId: 'ol_product_1', quantity: -4 });

      expect(result.available).toBe(0);
    });

    it('should write the named variant of a variation family', async () => {
      const { adapter, patch } = setup({
        listings: [parent('MUG', ['MUG-RED']), listing('MUG-RED', 1)],
        skuByInternalId: { ol_product_1: 'MUG', ol_variant_red: 'MUG-RED' },
      });

      await adapter.adjustInventory({ productId: 'ol_product_1', variantId: 'ol_variant_red', quantity: 2 });

      expect((patch.mock.calls as unknown[][])[0][0]).toBe(`/listings/2021-08-01/items/${SELLER}/MUG-RED`);
    });

    it('should refuse a variation parent without a named variant', async () => {
      const { adapter } = setup({ listings: [parent('MUG', ['MUG-RED']), listing('MUG-RED', 1)] });

      await expect(adapter.adjustInventory({ productId: 'ol_product_1', quantity: 1 })).rejects.toThrow(
        AmazonNotSupportedException,
      );
    });

    it('should never write FBA stock', async () => {
      const { adapter, patch } = setup({
        listings: [listing('MUG', null, { fulfillmentAvailability: [{ fulfillmentChannelCode: 'AMAZON_EU', quantity: 9 }] })],
        config: FBA_CONFIG,
        stockLocationOverride: 'ol_location_main',
      });

      await expect(adapter.adjustInventory({ productId: 'ol_product_1', quantity: 1 })).rejects.toThrow(
        AmazonNotSupportedException,
      );
      await expect(
        adapter.adjustInventory({ productId: 'ol_product_1', quantity: 1, locationId: 'ol_location_fba' }),
      ).rejects.toThrow(AmazonNotSupportedException);
      expect(patch).not.toHaveBeenCalled();
    });

    it('should honour an idempotency key through the cache', async () => {
      const { adapter, patch } = setup({ listings: [listing('MUG', 5)] });

      const first = await adapter.adjustInventory({ productId: 'ol_product_1', quantity: 1, idempotencyKey: 'k1' });
      const second = await adapter.adjustInventory({ productId: 'ol_product_1', quantity: 1, idempotencyKey: 'k1' });

      expect(patch).toHaveBeenCalledTimes(1);
      expect(first.adjustmentOutcome).toEqual({ disposition: 'applied', idempotency: 'honoured', appliedAt: null });
      expect(second.adjustmentOutcome).toEqual({ disposition: 'deduplicated', idempotency: 'honoured', appliedAt: null });
    });

    it('should not record a key when Amazon refuses the patch', async () => {
      const { adapter, patch } = setup({ listings: [listing('MUG', 5)] });
      patch.mockResolvedValueOnce(
        ok({ sku: 'MUG', status: 'INVALID', submissionId: 's', issues: [{ code: 'E', message: 'bad', severity: 'ERROR' }] }),
      );

      await expect(
        adapter.adjustInventory({ productId: 'ol_product_1', quantity: 1, idempotencyKey: 'k2' }),
      ).rejects.toThrow(AmazonApiError);
      await adapter.adjustInventory({ productId: 'ol_product_1', quantity: 1, idempotencyKey: 'k2' });

      expect(patch).toHaveBeenCalledTimes(2);
    });

    it('should report a key as unsupported without a cache', async () => {
      const { adapter } = setup({ listings: [listing('MUG', 5)], withCache: false });

      const result = await adapter.adjustInventory({ productId: 'ol_product_1', quantity: 1, idempotencyKey: 'k3' });

      expect(result.adjustmentOutcome?.idempotency).toBe('unsupported');
    });
  });

  it('should refuse the deprecated hold methods', async () => {
    const { adapter } = setup({ listings: [] });

    await expect(adapter.reserveInventory('p', 1, 'o')).rejects.toThrow(AmazonNotSupportedException);
    await expect(adapter.releaseInventory('p', 1, 'o')).rejects.toThrow(AmazonNotSupportedException);
  });
});
