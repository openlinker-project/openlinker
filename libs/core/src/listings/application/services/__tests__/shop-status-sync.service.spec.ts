/**
 * Shop Status Sync Service — unit spec (#1845)
 *
 * Covers capability gating (no ShopProductStatusReader -> zeroed skip), the
 * reconcile loop (upsert per published/draft record), transition + removed
 * counting, and scan-offset wrap-around.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { ListingCreationRecord } from '../../../domain/entities/listing-creation-record.entity';
import { LISTING_CREATION_STATUS } from '../../../domain/types/listing-creation-record.types';
import { SHOP_PUBLICATION_STATUS } from '../../../domain/types/shop-product-status.types';
import { ShopStatusSyncService } from '../shop-status-sync.service';

const CONN = 'conn-shop-1';

function makeRecord(id: string, variantId: string, externalProductId: string): ListingCreationRecord {
  const now = new Date('2026-07-01T10:00:00Z');
  return new ListingCreationRecord(
    id,
    variantId,
    CONN,
    externalProductId,
    LISTING_CREATION_STATUS.Published,
    null,
    now,
    now,
  );
}

describe('ShopStatusSyncService', () => {
  let integrations: { getCapabilityAdapter: jest.Mock };
  let records: { findPublishedByConnection: jest.Mock };
  let snapshots: { upsert: jest.Mock };
  let productsService: { getVariant: jest.Mock; getVariantsByProductId: jest.Mock };
  let identifierMapping: { getExternalIds: jest.Mock };
  let adapter: {
    publishProduct: jest.Mock;
    getShopProductStatus?: jest.Mock;
    getShopVariationStatus?: jest.Mock;
  };
  let service: ShopStatusSyncService;

  beforeEach(() => {
    adapter = {
      publishProduct: jest.fn(),
      getShopProductStatus: jest
        .fn()
        .mockResolvedValue({ publicationStatus: SHOP_PUBLICATION_STATUS.Published }),
    };
    integrations = { getCapabilityAdapter: jest.fn().mockResolvedValue(adapter) };
    records = {
      findPublishedByConnection: jest.fn().mockResolvedValue({
        items: [makeRecord('rec-a', 'ol_variant_a', 'wc-1')],
        total: 1,
      }),
    };
    snapshots = { upsert: jest.fn().mockResolvedValue({ previousStatus: null }) };
    productsService = {
      getVariant: jest.fn().mockResolvedValue({ productId: 'ol_product_a' }),
      getVariantsByProductId: jest.fn().mockResolvedValue([{ id: 'ol_variant_a' }]),
    };
    identifierMapping = { getExternalIds: jest.fn().mockResolvedValue([]) };
    service = new ShopStatusSyncService(
      integrations as never,
      records as never,
      snapshots as never,
      productsService as never,
      identifierMapping as never,
    );
  });

  it('should skip with a zeroed result when the adapter lacks ShopProductStatusReader', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({ publishProduct: jest.fn() });

    const result = await service.sync(CONN, { limit: 100 });

    expect(result).toEqual({
      scanned: 0,
      updated: 0,
      transitioned: 0,
      removed: 0,
      total: 0,
      nextOffset: 0,
    });
    expect(records.findPublishedByConnection).not.toHaveBeenCalled();
  });

  it('should upsert a snapshot for each published/draft record', async () => {
    const result = await service.sync(CONN, { limit: 100 });

    expect(adapter.getShopProductStatus).toHaveBeenCalledWith('wc-1');
    expect(snapshots.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: CONN,
        externalProductId: 'wc-1',
        internalVariantId: 'ol_variant_a',
        publicationStatus: SHOP_PUBLICATION_STATUS.Published,
      }),
    );
    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.nextOffset).toBe(0); // wrapped (offset+limit >= total)
  });

  it('should count transitions and removed products', async () => {
    adapter.getShopProductStatus = jest
      .fn()
      .mockResolvedValue({ publicationStatus: SHOP_PUBLICATION_STATUS.Removed });
    snapshots.upsert.mockResolvedValue({ previousStatus: SHOP_PUBLICATION_STATUS.Published });

    const result = await service.sync(CONN, { limit: 100 });

    expect(result.transitioned).toBe(1);
    expect(result.removed).toBe(1);
  });

  it('should advance the scan offset when more records remain', async () => {
    records.findPublishedByConnection.mockResolvedValue({
      items: [makeRecord('rec-a', 'ol_variant_a', 'wc-1')],
      total: 10,
    });

    const result = await service.sync(CONN, { limit: 1, offset: 0 });

    expect(result.nextOffset).toBe(1);
  });

  describe('grouped-variation status read (whole-epic review finding #2)', () => {
    it('should call the standalone getShopProductStatus path (no regression) for a simple-product record', async () => {
      productsService.getVariantsByProductId.mockResolvedValue([{ id: 'ol_variant_a' }]); // single variant, not grouped
      adapter.getShopVariationStatus = jest.fn();

      await service.sync(CONN, { limit: 100 });

      expect(adapter.getShopProductStatus).toHaveBeenCalledWith('wc-1');
      expect(adapter.getShopVariationStatus).not.toHaveBeenCalled();
    });

    it('should call the variation-aware read with parent+variation ids for a grouped-variant record, and not report it removed when the variation is live', async () => {
      productsService.getVariant.mockResolvedValue({ productId: 'ol_product_a' });
      productsService.getVariantsByProductId.mockResolvedValue([
        { id: 'ol_variant_a' },
        { id: 'ol_variant_b' },
      ]); // multi-variant → grouped
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: 'wc-parent-1', connectionId: CONN, entityType: 'ShopProduct', platformType: 'woocommerce' },
      ]);
      adapter.getShopVariationStatus = jest
        .fn()
        .mockResolvedValue({ publicationStatus: SHOP_PUBLICATION_STATUS.Published });

      const result = await service.sync(CONN, { limit: 100 });

      expect(adapter.getShopVariationStatus).toHaveBeenCalledWith('wc-parent-1', 'wc-1');
      expect(adapter.getShopProductStatus).not.toHaveBeenCalled();
      expect(result.removed).toBe(0);
      expect(snapshots.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ publicationStatus: SHOP_PUBLICATION_STATUS.Published }),
      );
    });

    it('should fall back to getShopProductStatus when grouped but no parent mapping is resolvable', async () => {
      productsService.getVariantsByProductId.mockResolvedValue([
        { id: 'ol_variant_a' },
        { id: 'ol_variant_b' },
      ]);
      identifierMapping.getExternalIds.mockResolvedValue([]); // no parent mapping yet
      adapter.getShopVariationStatus = jest.fn();

      await service.sync(CONN, { limit: 100 });

      expect(adapter.getShopVariationStatus).not.toHaveBeenCalled();
      expect(adapter.getShopProductStatus).toHaveBeenCalledWith('wc-1');
    });

    it('should fall back to getShopProductStatus when the adapter does not implement getShopVariationStatus', async () => {
      productsService.getVariantsByProductId.mockResolvedValue([
        { id: 'ol_variant_a' },
        { id: 'ol_variant_b' },
      ]);
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: 'wc-parent-1', connectionId: CONN, entityType: 'ShopProduct', platformType: 'woocommerce' },
      ]);
      // adapter.getShopVariationStatus intentionally left undefined.

      await service.sync(CONN, { limit: 100 });

      expect(adapter.getShopProductStatus).toHaveBeenCalledWith('wc-1');
    });
  });
});
