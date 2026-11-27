/**
 * Stale Offer Pause Service Tests
 *
 * Covers both entry points (#1689): `pauseOffersForVariants` re-verifies
 * staleness before enqueuing and fans out across connections; `sweepConnection`
 * pages the offer-mapping and shop-mapping read models and re-asserts the same
 * pause. Verifies per-mapping failure isolation and the dedupe-key composition.
 *
 * Since #3962 also covers shop products: a whole-product deletion hides the
 * product through `ShopProductVisibilityWriter` (parent listing for a grouped
 * product, the lone variant listing for a simple one), a one-variant deletion
 * zeroes the variation where the connection writes stock, and every outcome is
 * recorded as a `ListingSaleHold`.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { StaleOfferPauseService } from '../stale-offer-pause.service';
import type {
  IIdentifierMappingService,
  ExternalIdMapping,
} from '@openlinker/core/identifier-mapping';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IProductsService, ProductVariant } from '@openlinker/core/products';
import type { SyncJobQueuePort } from '@openlinker/core/sync';
import type {
  ListingSaleHold,
  ListingSaleHoldRepositoryPort,
  OfferMappingRepositoryPort,
  ShopProductMappingRepositoryPort,
  StaleMappedVariant,
} from '@openlinker/core/listings';

const STALE_AT = new Date('2026-07-01T00:00:00.000Z');
const STALE_AT_ISO = '2026-07-01T00:00:00.000Z';

function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'ol_variant_a',
    productId: 'ol_product_a',
    sku: null,
    attributes: null,
    ean: null,
    gtin: null,
    isStale: true,
    staleAt: STALE_AT,
    ...overrides,
  };
}

function mapping(overrides: Partial<ExternalIdMapping> = {}): ExternalIdMapping {
  return {
    externalId: 'offer-1',
    platformType: 'allegro',
    connectionId: 'conn-1',
    entityType: 'Offer',
    ...overrides,
  };
}

function shopMapping(connectionId: string, externalId: string): ExternalIdMapping {
  return { externalId, connectionId, platformType: 'woocommerce', entityType: 'ShopProduct' };
}

const EMPTY_SHOP_COUNTS = {
  shopProductsHidden: 0,
  shopListingsZeroed: 0,
  shopListingsNotStopped: 0,
};

describe('StaleOfferPauseService', () => {
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let productsService: {
    getVariant: jest.Mock;
    getVariantsByProductId: jest.Mock;
    getVariantsByIds: jest.Mock;
  };
  let bundleDefinitions: { findCurrentContainingComponents: jest.Mock; list: jest.Mock };
  let offerMappings: jest.Mocked<OfferMappingRepositoryPort>;
  let jobQueue: jest.Mocked<SyncJobQueuePort>;
  let shopMappings: { findStaleMappedProductIds: jest.Mock };
  let holds: { recordActive: jest.Mock; findActiveByListings: jest.Mock };
  let integrations: { getCapabilityAdapter: jest.Mock; getAdapter: jest.Mock };
  let service: StaleOfferPauseService;

  /** Route getExternalIds by `entityType:internalId`, unmatched keys answer `[]`. */
  const mockMappings = (byKey: Record<string, ExternalIdMapping[]>): void => {
    identifierMapping.getExternalIds.mockImplementation((entityType: string, internalId: string) =>
      Promise.resolve(byKey[`${entityType}:${internalId}`] ?? [])
    );
  };

  /** Variants of `ol_product_a`, also served by `getVariant` by id. */
  const mockVariants = (variants: ProductVariant[]): void => {
    productsService.getVariantsByProductId.mockResolvedValue(variants);
    productsService.getVariant.mockImplementation((id: string) =>
      Promise.resolve(variants.find((v) => v.id === id) ?? null)
    );
  };

  /** The `getAdapter` answer the per-variant stock path reads. */
  const mockConnection = (enabled: string[], supported: string[]): void => {
    integrations.getAdapter.mockResolvedValue({
      connection: { enabledCapabilities: enabled },
      metadata: { supportedCapabilities: supported },
    });
  };

  const appliedHold = (externalId: string): ListingSaleHold =>
    ({ externalId, outcome: 'applied' }) as unknown as ListingSaleHold;

  beforeEach(() => {
    identifierMapping = {
      getExternalIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    productsService = {
      getVariant: jest.fn().mockResolvedValue(makeVariant()),
      getVariantsByProductId: jest.fn().mockResolvedValue([makeVariant()]),
      getVariantsByIds: jest.fn().mockResolvedValue([]),
    };
    bundleDefinitions = {
      findCurrentContainingComponents: jest.fn().mockResolvedValue([]),
      list: jest.fn().mockResolvedValue([]),
    };

    offerMappings = {
      findById: jest.fn(),
      findMany: jest.fn(),
      findManyRows: jest.fn(),
      countMany: jest.fn(),
      findMappingPage: jest.fn(),
      countByLifecycle: jest.fn(),
      countAttention: jest.fn(),
      countByConnectionAndVariants: jest.fn(),
      findDeadFailedCreationOfferIds: jest.fn(),
      countListedVariantsByProducts: jest.fn(),
      findStaleMappedVariants: jest.fn().mockResolvedValue([]),
      findRecentlyListedVariantIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<OfferMappingRepositoryPort>;

    jobQueue = {
      enqueue: jest.fn().mockResolvedValue('job-1'),
      enqueueBulk: jest.fn(),
    } as unknown as jest.Mocked<SyncJobQueuePort>;

    shopMappings = { findStaleMappedProductIds: jest.fn().mockResolvedValue([]) };

    holds = {
      recordActive: jest.fn().mockResolvedValue({}),
      findActiveByListings: jest.fn().mockResolvedValue([]),
    };

    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue({}),
      getAdapter: jest.fn().mockRejectedValue(new Error('not configured in this test')),
    };

    service = new StaleOfferPauseService(
      identifierMapping,
      productsService as unknown as IProductsService,
      offerMappings,
      jobQueue,
      bundleDefinitions as never,
      shopMappings as unknown as ShopProductMappingRepositoryPort,
      holds as unknown as ListingSaleHoldRepositoryPort,
      integrations as unknown as IIntegrationsService
    );
  });

  describe('bundles with a stale component (#3931)', () => {
    const bundle = {
      variantId: 'ol_variant_set',
      version: 1,
      components: [
        { variantId: 'ol_variant_a', productId: 'p-a', quantity: 1 },
        { variantId: 'ol_variant_b', productId: 'p-b', quantity: 2 },
      ],
    };
    const staleAt = new Date('2026-10-01T00:00:00.000Z');

    it('should pause the bundle offers when a component is stale (event path)', async () => {
      productsService.getVariant.mockResolvedValue(makeVariant({ isStale: true, staleAt }));
      bundleDefinitions.findCurrentContainingComponents.mockResolvedValue([bundle]);
      productsService.getVariantsByIds.mockResolvedValue([
        { id: 'ol_variant_a', isStale: true, staleAt } as never,
        { id: 'ol_variant_b', isStale: false } as never,
      ]);
      identifierMapping.getExternalIds.mockImplementation((_t: string, id: string) =>
        Promise.resolve(
          id === 'ol_variant_set' ? [mapping({ connectionId: 'conn-1', externalId: 'bundle-offer' })] : []
        )
      );

      await service.pauseOffersForVariants({ variantIds: ['ol_variant_a'], correlationId: 'c' });

      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-1',
          payload: expect.objectContaining({ offerId: 'bundle-offer', quantity: 0 }),
        })
      );
    });

    it('should not pause a bundle whose component is no longer stale', async () => {
      productsService.getVariant.mockResolvedValue(makeVariant({ isStale: false }));
      bundleDefinitions.findCurrentContainingComponents.mockResolvedValue([bundle]);
      productsService.getVariantsByIds.mockResolvedValue([
        { id: 'ol_variant_a', isStale: false } as never,
        { id: 'ol_variant_b', isStale: false } as never,
      ]);

      await service.pauseOffersForVariants({ variantIds: ['ol_variant_a'], correlationId: 'c' });

      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should find the bundle from persisted state in the sweep, for its own connection only', async () => {
      bundleDefinitions.list.mockResolvedValue([bundle]);
      productsService.getVariantsByIds.mockResolvedValue([
        { id: 'ol_variant_b', isStale: true, staleAt } as never,
      ]);
      identifierMapping.getExternalIds.mockResolvedValue([
        mapping({ connectionId: 'conn-1', externalId: 'offer-1' }),
        mapping({ connectionId: 'conn-2', externalId: 'offer-2' }),
      ]);

      const result = await service.sweepConnection('conn-1', { limit: 10 });

      expect(result.offersPaused).toBe(1);
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-1',
          payload: expect.objectContaining({ offerId: 'offer-1', quantity: 0 }),
        })
      );
    });
  });

  describe('pauseOffersForVariants - marketplace offers', () => {
    it('should drop the variant and enqueue nothing when it is no longer stale', async () => {
      productsService.getVariant.mockResolvedValueOnce(makeVariant({ isStale: false }));

      const result = await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(identifierMapping.getExternalIds).not.toHaveBeenCalled();
      expect(productsService.getVariantsByProductId).not.toHaveBeenCalled();
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(holds.recordActive).not.toHaveBeenCalled();
      expect(result).toEqual({
        variantsConsidered: 1,
        variantsStillStale: 0,
        offersPaused: 0,
        offersSkipped: 0,
        ...EMPTY_SHOP_COUNTS,
      });
    });

    it('should fan out across multiple connections with the right connectionId per job when the variant has several offers', async () => {
      mockMappings({
        'Offer:ol_variant_a': [
          mapping({ connectionId: 'conn-1', externalId: 'offer-1' }),
          mapping({ connectionId: 'conn-2', externalId: 'offer-2' }),
        ],
      });

      const result = await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'marketplace.offerQuantity.update',
          connectionId: 'conn-1',
          payload: expect.objectContaining({ offerId: 'offer-1', quantity: 0 }),
        })
      );
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'marketplace.offerQuantity.update',
          connectionId: 'conn-2',
          payload: expect.objectContaining({ offerId: 'offer-2', quantity: 0 }),
        })
      );
      expect(result).toEqual({
        variantsConsidered: 1,
        variantsStillStale: 1,
        offersPaused: 2,
        offersSkipped: 0,
        ...EMPTY_SHOP_COUNTS,
      });
    });

    it('should record an applied stock_zero hold per offer when the enqueue succeeds', async () => {
      mockMappings({
        'Offer:ol_variant_a': [mapping({ connectionId: 'conn-1', externalId: 'offer-1' })],
      });

      await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(holds.recordActive).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        entityType: 'Offer',
        externalId: 'offer-1',
        externalParentId: null,
        internalProductId: 'ol_product_a',
        internalVariantId: 'ol_variant_a',
        method: 'stock_zero',
        outcome: 'applied',
        outcomeReason: null,
        staleAt: STALE_AT,
        appliedAt: expect.any(Date),
      });
    });

    it('should stamp the variant staleAt as the payload observedAt when pausing an offer (#2285)', async () => {
      mockMappings({
        'Offer:ol_variant_a': [mapping({ connectionId: 'conn-1', externalId: 'offer-1' })],
      });

      await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ observedAt: STALE_AT_ISO }),
        })
      );
    });

    it('should compose the dedupe key from connectionId, externalOfferId, and staleAt when enqueuing', async () => {
      mockMappings({
        'Offer:ol_variant_a': [mapping({ connectionId: 'conn-1', externalId: 'offer-1' })],
      });

      await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          options: { dedupeKey: `stale-pause:conn-1:offer-1:${STALE_AT_ISO}` },
        })
      );
    });

    it('should isolate a single enqueue failure and record a failed hold when one enqueue throws', async () => {
      mockMappings({
        'Offer:ol_variant_a': [
          mapping({ connectionId: 'conn-1', externalId: 'offer-1' }),
          mapping({ connectionId: 'conn-2', externalId: 'offer-2' }),
        ],
      });
      jobQueue.enqueue.mockRejectedValueOnce(new Error('redis unavailable'));

      const result = await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(holds.recordActive).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: 'offer-1',
          method: 'stock_zero',
          outcome: 'failed',
          outcomeReason: 'error',
        })
      );
      expect(holds.recordActive).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: 'offer-2', outcome: 'applied' })
      );
      expect(result).toEqual({
        variantsConsidered: 1,
        variantsStillStale: 1,
        offersPaused: 1,
        offersSkipped: 1,
        ...EMPTY_SHOP_COUNTS,
      });
    });

    it('should consider every variant of the product when variantIds is empty and internalProductId is given', async () => {
      mockVariants([
        makeVariant({ id: 'ol_variant_a' }),
        makeVariant({ id: 'ol_variant_b' }),
      ]);

      const result = await service.pauseOffersForVariants({
        variantIds: [],
        internalProductId: 'ol_product_a',
        correlationId: 'corr-1',
      });

      expect(productsService.getVariantsByProductId).toHaveBeenCalledWith('ol_product_a');
      expect(productsService.getVariant).toHaveBeenCalledWith('ol_variant_a');
      expect(productsService.getVariant).toHaveBeenCalledWith('ol_variant_b');
      expect(result.variantsConsidered).toBe(2);
      expect(result.variantsStillStale).toBe(2);
    });
  });

  describe('pauseOffersForVariants - shop products, whole product deleted', () => {
    beforeEach(() => {
      mockVariants([
        makeVariant({ id: 'ol_variant_a' }),
        makeVariant({ id: 'ol_variant_b' }),
      ]);
    });

    it('should hide the parent shop product when a grouped product is deleted and the shop can change visibility', async () => {
      const adapter = { setShopProductVisibility: jest.fn().mockResolvedValue(undefined) };
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      mockMappings({
        'ShopProduct:ol_product_a': [shopMapping('shop-1', 'P100')],
        'ShopProduct:ol_variant_a': [shopMapping('shop-1', 'V1')],
        'ShopProduct:ol_variant_b': [shopMapping('shop-1', 'V2')],
      });

      const result = await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a', 'ol_variant_b'],
        correlationId: 'corr-1',
      });

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith('shop-1', 'ProductPublisher');
      expect(adapter.setShopProductVisibility).toHaveBeenCalledTimes(1);
      expect(adapter.setShopProductVisibility).toHaveBeenCalledWith({
        externalProductId: 'P100',
        visible: false,
      });
      expect(holds.recordActive).toHaveBeenCalledWith({
        connectionId: 'shop-1',
        entityType: 'ShopProduct',
        externalId: 'P100',
        externalParentId: null,
        internalProductId: 'ol_product_a',
        internalVariantId: null,
        method: 'unpublished',
        outcome: 'applied',
        outcomeReason: null,
        staleAt: STALE_AT,
        appliedAt: expect.any(Date),
      });
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(result.shopProductsHidden).toBe(1);
      expect(result.shopListingsNotStopped).toBe(0);
    });

    it('should hide the variant listing itself when a simple product has no parent mapping', async () => {
      mockVariants([makeVariant({ id: 'ol_variant_a' })]);
      const adapter = { setShopProductVisibility: jest.fn().mockResolvedValue(undefined) };
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      mockMappings({ 'ShopProduct:ol_variant_a': [shopMapping('shop-1', 'V1')] });

      const result = await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(adapter.setShopProductVisibility).toHaveBeenCalledWith({
        externalProductId: 'V1',
        visible: false,
      });
      expect(holds.recordActive).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'ShopProduct',
          externalId: 'V1',
          internalVariantId: 'ol_variant_a',
          method: 'unpublished',
          outcome: 'applied',
        })
      );
      expect(result.shopProductsHidden).toBe(1);
    });

    it('should record a failed hold and not throw when the visibility write throws', async () => {
      const adapter = {
        setShopProductVisibility: jest.fn().mockRejectedValue(new Error('shop 503')),
      };
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      mockMappings({
        'ShopProduct:ol_product_a': [shopMapping('shop-1', 'P100')],
        'ShopProduct:ol_variant_a': [shopMapping('shop-1', 'V1')],
      });

      const result = await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a', 'ol_variant_b'],
        correlationId: 'corr-1',
      });

      expect(holds.recordActive).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: 'P100',
          method: 'unpublished',
          outcome: 'failed',
          outcomeReason: 'error',
        })
      );
      expect(result.shopProductsHidden).toBe(0);
      expect(result.shopListingsNotStopped).toBe(1);
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should fall back to per-variant stock 0 when the adapter has no visibility writer', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue({});
      mockConnection(['ProductPublisher', 'OfferManager'], ['ProductPublisher', 'OfferManager']);
      mockMappings({
        'ShopProduct:ol_product_a': [shopMapping('shop-1', 'P100')],
        'ShopProduct:ol_variant_a': [shopMapping('shop-1', 'V1')],
        'ShopProduct:ol_variant_b': [shopMapping('shop-1', 'V2')],
      });

      const result = await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a', 'ol_variant_b'],
        correlationId: 'corr-1',
      });

      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'shop-1',
          payload: expect.objectContaining({
            offerId: 'V1',
            quantity: 0,
            externalParentId: 'P100',
          }),
        })
      );
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ offerId: 'V2', externalParentId: 'P100' }),
        })
      );
      expect(result.shopProductsHidden).toBe(0);
      expect(result.shopListingsZeroed).toBe(2);
    });

    it('should not re-apply anything when the listing already has an applied hold', async () => {
      const adapter = { setShopProductVisibility: jest.fn() };
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      holds.findActiveByListings.mockResolvedValue([appliedHold('P100')]);
      mockMappings({
        'ShopProduct:ol_product_a': [shopMapping('shop-1', 'P100')],
        'ShopProduct:ol_variant_a': [shopMapping('shop-1', 'V1')],
      });

      const result = await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a', 'ol_variant_b'],
        correlationId: 'corr-1',
      });

      expect(holds.findActiveByListings).toHaveBeenCalledWith([
        { connectionId: 'shop-1', entityType: 'ShopProduct', externalId: 'P100' },
      ]);
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(adapter.setShopProductVisibility).not.toHaveBeenCalled();
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(holds.recordActive).not.toHaveBeenCalled();
      expect(result.shopProductsHidden).toBe(0);
    });
  });

  describe('pauseOffersForVariants - shop products, one variant deleted', () => {
    beforeEach(() => {
      mockVariants([
        makeVariant({ id: 'ol_variant_a' }),
        makeVariant({ id: 'ol_variant_b', isStale: false, staleAt: null }),
      ]);
      mockMappings({
        'ShopProduct:ol_product_a': [shopMapping('shop-1', 'P100')],
        'ShopProduct:ol_variant_a': [shopMapping('shop-1', 'V1')],
        'ShopProduct:ol_variant_b': [shopMapping('shop-1', 'V2')],
      });
    });

    it('should zero the deleted variation under its parent when stock updates are enabled and the shop is not the inventory master', async () => {
      mockConnection(['ProductPublisher', 'OfferManager'], ['ProductPublisher', 'OfferManager']);

      const result = await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(jobQueue.enqueue).toHaveBeenCalledWith({
        type: 'marketplace.offerQuantity.update',
        connectionId: 'shop-1',
        payload: {
          schemaVersion: 1,
          offerId: 'V1',
          quantity: 0,
          observedAt: STALE_AT_ISO,
          externalParentId: 'P100',
        },
        options: { dedupeKey: `stale-pause:shop-1:V1:${STALE_AT_ISO}` },
      });
      expect(holds.recordActive).toHaveBeenCalledWith({
        connectionId: 'shop-1',
        entityType: 'ShopProduct',
        externalId: 'V1',
        externalParentId: 'P100',
        internalProductId: 'ol_product_a',
        internalVariantId: 'ol_variant_a',
        method: 'stock_zero',
        outcome: 'applied',
        outcomeReason: null,
        staleAt: STALE_AT,
        appliedAt: expect.any(Date),
      });
      expect(result.shopListingsZeroed).toBe(1);
    });

    it('should record a not_possible hold with stock_sync_off when the shop supports stock writes but has them switched off', async () => {
      mockConnection(['ProductPublisher'], ['ProductPublisher', 'OfferManager']);

      const result = await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(holds.recordActive).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: 'V1',
          method: 'none',
          outcome: 'not_possible',
          outcomeReason: 'stock_sync_off',
        })
      );
      expect(result.shopListingsNotStopped).toBe(1);
    });

    it('should record a not_possible hold with no_stock_write when the adapter cannot write stock at all', async () => {
      mockConnection(['ProductPublisher'], ['ProductPublisher']);

      const result = await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(holds.recordActive).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'none',
          outcome: 'not_possible',
          outcomeReason: 'no_stock_write',
        })
      );
      expect(result.shopListingsNotStopped).toBe(1);
    });

    it('should treat the inventory-master connection as not writing stock when it also has OfferManager enabled', async () => {
      mockConnection(['OfferManager', 'InventoryMaster'], ['OfferManager', 'InventoryMaster']);

      await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(holds.recordActive).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'not_possible', outcomeReason: 'stock_sync_off' })
      );
    });

    it('should not re-enqueue when the variation already has an applied hold', async () => {
      mockConnection(['OfferManager'], ['OfferManager']);
      holds.findActiveByListings.mockResolvedValue([appliedHold('V1')]);

      await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(holds.recordActive).not.toHaveBeenCalled();
    });
  });

  describe('sweepConnection', () => {
    it('should page stale-mapped variants and re-assert a quantity-0 pause for each when offers are stale', async () => {
      const rows: StaleMappedVariant[] = [
        { variantId: 'ol_variant_a', externalOfferId: 'offer-1', staleAt: STALE_AT },
        {
          variantId: 'ol_variant_b',
          externalOfferId: 'offer-2',
          staleAt: new Date('2026-07-02T00:00:00.000Z'),
        },
      ];
      offerMappings.findStaleMappedVariants.mockResolvedValueOnce(rows);

      const result = await service.sweepConnection('conn-1', { limit: 200 });

      expect(offerMappings.findStaleMappedVariants).toHaveBeenCalledWith(
        'conn-1',
        expect.objectContaining({ limit: 200, staleSince: expect.any(Date) })
      );
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(holds.recordActive).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        variantsConsidered: 2,
        variantsStillStale: 2,
        offersPaused: 2,
        offersSkipped: 0,
        ...EMPTY_SHOP_COUNTS,
      });
    });

    it('should enqueue nothing when the stale sets are empty', async () => {
      const result = await service.sweepConnection('conn-1', { limit: 200 });

      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(result).toEqual({
        variantsConsidered: 0,
        variantsStillStale: 0,
        offersPaused: 0,
        offersSkipped: 0,
        ...EMPTY_SHOP_COUNTS,
      });
    });

    it('should read stale shop products for the connection and act only on that connection when sweeping', async () => {
      mockVariants([makeVariant({ id: 'ol_variant_a' })]);
      shopMappings.findStaleMappedProductIds.mockResolvedValueOnce(['ol_product_a']);
      const adapter = { setShopProductVisibility: jest.fn().mockResolvedValue(undefined) };
      integrations.getCapabilityAdapter.mockResolvedValue(adapter);
      mockMappings({
        'ShopProduct:ol_product_a': [shopMapping('shop-1', 'P100'), shopMapping('shop-2', 'P200')],
        'ShopProduct:ol_variant_a': [shopMapping('shop-1', 'V1'), shopMapping('shop-2', 'V2')],
      });

      const result = await service.sweepConnection('shop-1', { limit: 50 });

      expect(shopMappings.findStaleMappedProductIds).toHaveBeenCalledWith(
        'shop-1',
        expect.objectContaining({ limit: 50, staleSince: expect.any(Date) })
      );
      expect(integrations.getCapabilityAdapter).toHaveBeenCalledTimes(1);
      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith('shop-1', 'ProductPublisher');
      expect(adapter.setShopProductVisibility).toHaveBeenCalledTimes(1);
      expect(adapter.setShopProductVisibility).toHaveBeenCalledWith({
        externalProductId: 'P100',
        visible: false,
      });
      expect(holds.recordActive).toHaveBeenCalledTimes(1);
      expect(holds.recordActive).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'shop-1', externalId: 'P100' })
      );
      expect(result.shopProductsHidden).toBe(1);
    });
  });
});
