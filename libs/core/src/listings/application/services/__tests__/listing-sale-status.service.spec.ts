/**
 * Listing Sale Status Service Tests (#3962)
 *
 * Covers the product page read (`getProductSaleStatus`: offer rows from the
 * status and commercial reads, shop rows from the variant mappings or one
 * parent row when the grouped product itself is held) and the operator
 * release (`releaseHolds`: refused while the product is still deleted at the
 * master, re-shows hidden shop products, releases, then re-propagates stock;
 * per-hold failures are reported, not thrown).
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { ListingSaleStatusService } from '../listing-sale-status.service';
import { ListingSaleHold } from '../../../domain/entities/listing-sale-hold.entity';
import { SaleHoldReleaseRefusedException } from '../../../domain/exceptions/sale-hold-release-refused.exception';
import type {
  ListingSaleHoldRepositoryPort,
  ShopProductStatusSnapshotRepositoryPort,
} from '@openlinker/core/listings';
import type { ListingSaleHoldProps } from '../../../domain/types/listing-sale-hold.types';
import type { IOfferCommercialReadService } from '../offer-commercial-read.service.interface';
import type { IOfferStatusReadService } from '../offer-status-read.service.interface';
import type {
  ExternalIdMapping,
  IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IProductsService, ProductVariant } from '@openlinker/core/products';
import type { SyncJobQueuePort } from '@openlinker/core/sync';

const D1 = new Date('2026-07-01T00:00:00.000Z');
const D3 = new Date('2026-07-03T00:00:00.000Z');
const D5 = new Date('2026-07-05T00:00:00.000Z');

function variant(id: string, stale: Date | null): ProductVariant {
  return {
    id,
    productId: 'ol_product_a',
    sku: null,
    attributes: null,
    ean: null,
    gtin: null,
    isStale: stale !== null,
    staleAt: stale,
  };
}

function hold(overrides: Partial<ListingSaleHoldProps> = {}): ListingSaleHold {
  return new ListingSaleHold({
    id: 'hold-1',
    connectionId: 'shop-1',
    entityType: 'ShopProduct',
    externalId: 'V1',
    externalParentId: null,
    internalProductId: 'ol_product_a',
    internalVariantId: 'ol_variant_a',
    method: 'stock_zero',
    outcome: 'applied',
    outcomeReason: null,
    staleAt: D1,
    appliedAt: D1,
    releasedAt: null,
    releasedBy: null,
    createdAt: D1,
    updatedAt: D1,
    ...overrides,
  });
}

function shopMapping(connectionId: string, externalId: string): ExternalIdMapping {
  return { connectionId, externalId, platformType: 'woocommerce', entityType: 'ShopProduct' };
}

describe('ListingSaleStatusService', () => {
  let productsService: { getVariantsByProductId: jest.Mock };
  let identifierMapping: { getExternalIds: jest.Mock };
  let offerStatusRead: { getPublicationStatusForProduct: jest.Mock };
  let offerCommercialRead: { getObservedQuantities: jest.Mock };
  let shopSnapshots: { findByVariantIds: jest.Mock };
  let holds: {
    findActiveByProductId: jest.Mock;
    findByIdsForProduct: jest.Mock;
    findActiveByListings: jest.Mock;
    release: jest.Mock;
    countProductsNeedingAttention: jest.Mock;
  };
  let integrations: { getCapabilityAdapter: jest.Mock };
  let jobQueue: { enqueue: jest.Mock };
  let service: ListingSaleStatusService;

  const mockMappings = (byKey: Record<string, ExternalIdMapping[]>): void => {
    identifierMapping.getExternalIds.mockImplementation((entityType: string, id: string) =>
      Promise.resolve(byKey[`${entityType}:${id}`] ?? [])
    );
  };

  beforeEach(() => {
    productsService = { getVariantsByProductId: jest.fn().mockResolvedValue([]) };
    identifierMapping = { getExternalIds: jest.fn().mockResolvedValue([]) };
    offerStatusRead = { getPublicationStatusForProduct: jest.fn().mockResolvedValue([]) };
    offerCommercialRead = { getObservedQuantities: jest.fn().mockResolvedValue([]) };
    shopSnapshots = { findByVariantIds: jest.fn().mockResolvedValue([]) };
    holds = {
      findActiveByProductId: jest.fn().mockResolvedValue([]),
      findByIdsForProduct: jest.fn().mockResolvedValue([]),
      findActiveByListings: jest.fn().mockResolvedValue([]),
      release: jest.fn().mockResolvedValue(1),
      countProductsNeedingAttention: jest.fn().mockResolvedValue(0),
    };
    integrations = { getCapabilityAdapter: jest.fn() };
    jobQueue = { enqueue: jest.fn().mockResolvedValue('job-1') };

    service = new ListingSaleStatusService(
      productsService as unknown as IProductsService,
      identifierMapping as unknown as IIdentifierMappingService,
      offerStatusRead as unknown as IOfferStatusReadService,
      offerCommercialRead as unknown as IOfferCommercialReadService,
      shopSnapshots as unknown as ShopProductStatusSnapshotRepositoryPort,
      holds as unknown as ListingSaleHoldRepositoryPort,
      integrations as unknown as IIntegrationsService,
      jobQueue as unknown as SyncJobQueuePort
    );
  });

  describe('getProductSaleStatus', () => {
    it('should report the latest staleAt as deletedAt and list the stale variants when some are deleted', async () => {
      productsService.getVariantsByProductId.mockResolvedValue([
        variant('ol_variant_a', D1),
        variant('ol_variant_b', D3),
        variant('ol_variant_c', null),
      ]);

      const status = await service.getProductSaleStatus('ol_product_a');

      expect(status.productId).toBe('ol_product_a');
      expect(status.deletedAt).toEqual(D3);
      expect(status.deletedAtSource).toBe(true);
      expect(status.staleVariantIds).toEqual(['ol_variant_a', 'ol_variant_b']);
    });

    it('should report no deletion and skip the shop snapshot read when the product has no variants', async () => {
      const status = await service.getProductSaleStatus('ol_product_a');

      expect(shopSnapshots.findByVariantIds).not.toHaveBeenCalled();
      expect(status).toEqual({
        productId: 'ol_product_a',
        deletedAt: null,
        deletedAtSource: false,
        staleVariantIds: [],
        rows: [],
        checkedAt: null,
      });
    });

    it('should build offer rows from the status read and the commercial quantity when offers exist', async () => {
      productsService.getVariantsByProductId.mockResolvedValue([variant('ol_variant_a', D1)]);
      offerStatusRead.getPublicationStatusForProduct.mockResolvedValue([
        {
          connectionId: 'allegro-1',
          externalOfferId: 'offer-1',
          internalVariantId: 'ol_variant_a',
          publicationStatus: 'active',
          validationMessages: [],
          validationProblems: [],
          lastStatusSyncedAt: D3,
        },
        {
          connectionId: 'allegro-1',
          externalOfferId: 'offer-2',
          internalVariantId: 'ol_variant_a',
          publicationStatus: null,
          validationMessages: [],
          validationProblems: [],
          lastStatusSyncedAt: null,
        },
      ]);
      offerCommercialRead.getObservedQuantities.mockResolvedValue([
        {
          connectionId: 'allegro-1',
          internalVariantId: 'ol_variant_a',
          externalOfferId: 'offer-1',
          availableQuantity: 0,
          observedAt: D1,
        },
        {
          connectionId: 'allegro-1',
          internalVariantId: 'ol_variant_a',
          externalOfferId: 'offer-2',
          availableQuantity: 7,
          observedAt: D5,
        },
      ]);
      const offerHold = hold({
        id: 'hold-offer',
        connectionId: 'allegro-1',
        entityType: 'Offer',
        externalId: 'offer-1',
      });
      holds.findActiveByProductId.mockResolvedValue([offerHold]);

      const status = await service.getProductSaleStatus('ol_product_a');

      expect(offerCommercialRead.getObservedQuantities).toHaveBeenCalledWith(['ol_variant_a']);
      expect(status.rows).toEqual([
        {
          connectionId: 'allegro-1',
          entityType: 'Offer',
          externalId: 'offer-1',
          externalParentId: null,
          internalVariantId: 'ol_variant_a',
          channelStatus: 'active',
          quantity: 0,
          lastCheckedAt: D3,
          hold: {
            id: 'hold-offer',
            method: 'stock_zero',
            outcome: 'applied',
            outcomeReason: null,
            appliedAt: D1,
          },
          state: 'off_sale',
        },
        {
          connectionId: 'allegro-1',
          entityType: 'Offer',
          externalId: 'offer-2',
          externalParentId: null,
          internalVariantId: 'ol_variant_a',
          channelStatus: null,
          quantity: 7,
          lastCheckedAt: D5,
          hold: null,
          state: 'on_sale',
        },
      ]);
      expect(status.checkedAt).toEqual(D5);
    });

    it('should build one row per shop variant mapping with its parent id when no parent hold exists', async () => {
      productsService.getVariantsByProductId.mockResolvedValue([
        variant('ol_variant_a', D1),
        variant('ol_variant_b', null),
      ]);
      mockMappings({
        'ShopProduct:ol_product_a': [shopMapping('shop-1', 'P100')],
        'ShopProduct:ol_variant_a': [shopMapping('shop-1', 'V1')],
        'ShopProduct:ol_variant_b': [shopMapping('shop-1', 'V2')],
      });
      shopSnapshots.findByVariantIds.mockResolvedValue([
        {
          connectionId: 'shop-1',
          externalProductId: 'V2',
          publicationStatus: 'published',
          lastStatusSyncedAt: D3,
        },
      ]);
      holds.findActiveByProductId.mockResolvedValue([
        hold({ id: 'hold-v1', externalId: 'V1', externalParentId: 'P100' }),
      ]);

      const status = await service.getProductSaleStatus('ol_product_a');

      expect(shopSnapshots.findByVariantIds).toHaveBeenCalledWith(['ol_variant_a', 'ol_variant_b']);
      expect(status.rows).toHaveLength(2);
      expect(status.rows[0]).toEqual(
        expect.objectContaining({
          entityType: 'ShopProduct',
          externalId: 'V1',
          externalParentId: 'P100',
          internalVariantId: 'ol_variant_a',
          channelStatus: null,
          quantity: null,
          hold: expect.objectContaining({ id: 'hold-v1' }),
          state: 'off_sale',
        })
      );
      expect(status.rows[1]).toEqual(
        expect.objectContaining({
          externalId: 'V2',
          externalParentId: 'P100',
          internalVariantId: 'ol_variant_b',
          channelStatus: 'published',
          lastCheckedAt: D3,
          hold: null,
          state: 'on_sale',
        })
      );
    });

    it('should collapse a connection to one parent row when the grouped product itself is held', async () => {
      productsService.getVariantsByProductId.mockResolvedValue([
        variant('ol_variant_a', D1),
        variant('ol_variant_b', D1),
      ]);
      mockMappings({
        'ShopProduct:ol_product_a': [shopMapping('shop-1', 'P100'), shopMapping('shop-2', 'P200')],
        'ShopProduct:ol_variant_a': [shopMapping('shop-1', 'V1'), shopMapping('shop-2', 'W1')],
        'ShopProduct:ol_variant_b': [shopMapping('shop-1', 'V2')],
      });
      shopSnapshots.findByVariantIds.mockResolvedValue([
        {
          connectionId: 'shop-1',
          externalProductId: 'V1',
          publicationStatus: 'draft',
          lastStatusSyncedAt: D5,
        },
      ]);
      holds.findActiveByProductId.mockResolvedValue([
        hold({
          id: 'hold-parent',
          externalId: 'P100',
          internalVariantId: null,
          method: 'unpublished',
        }),
      ]);

      const status = await service.getProductSaleStatus('ol_product_a');

      const shop1Rows = status.rows.filter((r) => r.connectionId === 'shop-1');
      expect(shop1Rows).toEqual([
        {
          connectionId: 'shop-1',
          entityType: 'ShopProduct',
          externalId: 'P100',
          externalParentId: null,
          internalVariantId: null,
          channelStatus: 'draft',
          quantity: null,
          lastCheckedAt: D5,
          hold: {
            id: 'hold-parent',
            method: 'unpublished',
            outcome: 'applied',
            outcomeReason: null,
            appliedAt: D1,
          },
          state: 'off_sale',
        },
      ]);
      const shop2Rows = status.rows.filter((r) => r.connectionId === 'shop-2');
      expect(shop2Rows).toEqual([
        expect.objectContaining({
          externalId: 'W1',
          externalParentId: 'P200',
          hold: null,
          state: 'unknown',
        }),
      ]);
    });
  });

  describe('releaseHolds', () => {
    it('should return an empty result and touch nothing when no requested hold is active', async () => {
      holds.findByIdsForProduct.mockResolvedValue([
        hold({ releasedAt: D3, releasedBy: 'someone' }),
      ]);

      const result = await service.releaseHolds('ol_product_a', ['hold-1'], 'user-1');

      expect(result).toEqual({ released: [], failed: [] });
      expect(holds.release).not.toHaveBeenCalled();
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should refuse the whole release when a held variant is still stale', async () => {
      holds.findByIdsForProduct.mockResolvedValue([
        hold({ id: 'hold-a', internalVariantId: 'ol_variant_a' }),
        hold({ id: 'hold-b', internalVariantId: 'ol_variant_b', externalId: 'V2' }),
      ]);
      productsService.getVariantsByProductId.mockResolvedValue([
        variant('ol_variant_a', D1),
        variant('ol_variant_b', null),
      ]);

      const error = await service
        .releaseHolds('ol_product_a', ['hold-a', 'hold-b'], 'user-1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SaleHoldReleaseRefusedException);
      expect((error as SaleHoldReleaseRefusedException).holdIds).toEqual(['hold-a']);
      expect(holds.release).not.toHaveBeenCalled();
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should refuse a parent hold release when any variant of the product is still stale', async () => {
      holds.findByIdsForProduct.mockResolvedValue([
        hold({ id: 'hold-parent', externalId: 'P100', internalVariantId: null }),
      ]);
      productsService.getVariantsByProductId.mockResolvedValue([
        variant('ol_variant_a', null),
        variant('ol_variant_b', D1),
      ]);

      await expect(
        service.releaseHolds('ol_product_a', ['hold-parent'], 'user-1')
      ).rejects.toBeInstanceOf(SaleHoldReleaseRefusedException);
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should show the shop product again, release the hold and re-propagate every variant when an unpublished parent hold is released', async () => {
      const adapter = { setShopProductVisibility: jest.fn().mockResolvedValue(undefined) };
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      holds.findByIdsForProduct.mockResolvedValue([
        hold({
          id: 'hold-parent',
          externalId: 'P100',
          internalVariantId: null,
          method: 'unpublished',
        }),
      ]);
      productsService.getVariantsByProductId.mockResolvedValue([
        variant('ol_variant_a', null),
        variant('ol_variant_b', null),
      ]);

      const result = await service.releaseHolds('ol_product_a', ['hold-parent'], 'user-1');

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith('shop-1', 'ProductPublisher');
      expect(adapter.setShopProductVisibility).toHaveBeenCalledWith({
        externalProductId: 'P100',
        visible: true,
      });
      expect(holds.release).toHaveBeenCalledWith(['hold-parent'], 'user-1', expect.any(Date));
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'inventory.propagateToMarketplaces',
          // No master mapping in this fixture, so the job falls back to the
          // system scope rather than borrowing the channel's (#2609).
          connectionId: '00000000-0000-0000-0000-000000000000',
          payload: expect.objectContaining({
            productId: 'ol_product_a',
            variantId: 'ol_variant_a',
            inventoryUpdatedAt: expect.any(String),
          }),
          options: { dedupeKey: expect.stringMatching(/^sale-hold-release:ol_variant_a:/) },
        })
      );
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ variantId: 'ol_variant_b' }),
        })
      );
      expect(result).toEqual({ released: ['hold-parent'], failed: [] });
    });

    it('should release a stock_zero hold without a visibility write and re-propagate only its variant', async () => {
      holds.findByIdsForProduct.mockResolvedValue([
        hold({ id: 'hold-a', internalVariantId: 'ol_variant_a' }),
      ]);
      productsService.getVariantsByProductId.mockResolvedValue([
        variant('ol_variant_a', null),
        variant('ol_variant_b', null),
      ]);

      const result = await service.releaseHolds('ol_product_a', ['hold-a'], 'user-1');

      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ variantId: 'ol_variant_a' }),
        })
      );
      expect(result).toEqual({ released: ['hold-a'], failed: [] });
    });

    it('should report a per-hold failure without throwing when one visibility write fails', async () => {
      const adapter = {
        setShopProductVisibility: jest
          .fn()
          .mockRejectedValueOnce(new Error('shop 503'))
          .mockResolvedValueOnce(undefined),
      };
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      holds.findByIdsForProduct.mockResolvedValue([
        hold({
          id: 'hold-x',
          externalId: 'V1',
          internalVariantId: 'ol_variant_a',
          method: 'unpublished',
        }),
        hold({
          id: 'hold-y',
          externalId: 'V2',
          internalVariantId: 'ol_variant_b',
          method: 'unpublished',
        }),
      ]);
      productsService.getVariantsByProductId.mockResolvedValue([
        variant('ol_variant_a', null),
        variant('ol_variant_b', null),
      ]);

      const result = await service.releaseHolds('ol_product_a', ['hold-x', 'hold-y'], 'user-1');

      expect(result).toEqual({
        released: ['hold-y'],
        failed: [{ holdId: 'hold-x', message: 'shop 503' }],
      });
      expect(holds.release).toHaveBeenCalledTimes(1);
      expect(holds.release).toHaveBeenCalledWith(['hold-y'], 'user-1', expect.any(Date));
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ variantId: 'ol_variant_b' }),
        })
      );
    });

    it('should report a failure when the connection can no longer change visibility', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue({});
      holds.findByIdsForProduct.mockResolvedValue([
        hold({ id: 'hold-x', internalVariantId: 'ol_variant_a', method: 'unpublished' }),
      ]);
      productsService.getVariantsByProductId.mockResolvedValue([variant('ol_variant_a', null)]);

      const result = await service.releaseHolds('ol_product_a', ['hold-x'], 'user-1');

      expect(result.released).toEqual([]);
      expect(result.failed).toEqual([
        { holdId: 'hold-x', message: expect.stringContaining('cannot change product visibility') },
      ]);
      expect(holds.release).not.toHaveBeenCalled();
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should still report the release when the stock refresh enqueue fails', async () => {
      jobQueue.enqueue.mockRejectedValue(new Error('redis down'));
      holds.findByIdsForProduct.mockResolvedValue([
        hold({ id: 'hold-a', internalVariantId: 'ol_variant_a' }),
      ]);
      productsService.getVariantsByProductId.mockResolvedValue([variant('ol_variant_a', null)]);

      const result = await service.releaseHolds('ol_product_a', ['hold-a'], 'user-1');

      expect(result).toEqual({ released: ['hold-a'], failed: [] });
    });
  });

  describe('delegating reads', () => {
    it('should answer findActiveHolds from the repository when asked about listings', async () => {
      const active = [hold()];
      holds.findActiveByListings.mockResolvedValue(active);
      const refs = [{ connectionId: 'shop-1', entityType: 'ShopProduct' as const, externalId: 'V1' }];

      await expect(service.findActiveHolds(refs)).resolves.toBe(active);
      expect(holds.findActiveByListings).toHaveBeenCalledWith(refs);
    });

    it('should answer countProductsStillOnSale from the attention count when asked', async () => {
      holds.countProductsNeedingAttention.mockResolvedValue(3);

      await expect(service.countProductsStillOnSale()).resolves.toBe(3);
    });
  });
});
