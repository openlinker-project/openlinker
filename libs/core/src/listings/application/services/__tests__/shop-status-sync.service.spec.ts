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
  let adapter: { publishProduct: jest.Mock; getShopProductStatus?: jest.Mock };
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
    service = new ShopStatusSyncService(
      integrations as never,
      records as never,
      snapshots as never,
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
});
