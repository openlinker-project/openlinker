/**
 * Stale Offer Pause Service Tests
 *
 * Covers both entry points (#1689): `pauseOffersForVariants` re-verifies
 * staleness before enqueuing and fans out across connections; `sweepConnection`
 * pages the offer-mapping read model and re-asserts the same pause. Verifies
 * per-mapping failure isolation and the dedupe-key composition.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { StaleOfferPauseService } from '../stale-offer-pause.service';
import type { IIdentifierMappingService, ExternalIdMapping } from '@openlinker/core/identifier-mapping';
import type { IProductsService, ProductVariant } from '@openlinker/core/products';
import type { SyncJobQueuePort } from '@openlinker/core/sync';
import type { OfferMappingRepositoryPort, StaleMappedVariant } from '@openlinker/core/listings';

function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'ol_variant_a',
    productId: 'ol_product_a',
    sku: null,
    attributes: null,
    ean: null,
    gtin: null,
    isStale: true,
    staleAt: new Date('2026-07-01T00:00:00.000Z'),
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

describe('StaleOfferPauseService', () => {
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let productsService: jest.Mocked<Pick<IProductsService, 'getVariant' | 'getVariantsByIds'>>;
  let bundleDefinitions: { findCurrentContainingComponents: jest.Mock; list: jest.Mock };
  let offerMappings: jest.Mocked<OfferMappingRepositoryPort>;
  let jobQueue: jest.Mocked<SyncJobQueuePort>;
  let service: StaleOfferPauseService;

  beforeEach(() => {
    identifierMapping = {
      getExternalIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    productsService = {
      getVariant: jest.fn().mockResolvedValue(makeVariant()),
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
    };

    jobQueue = {
      enqueue: jest.fn().mockResolvedValue('job-1'),
      enqueueBulk: jest.fn(),
    } as unknown as jest.Mocked<SyncJobQueuePort>;

    service = new StaleOfferPauseService(
      identifierMapping,
      productsService as unknown as IProductsService,
      offerMappings,
      jobQueue,
      bundleDefinitions as never
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

  describe('pauseOffersForVariants', () => {
    it('drops a variant that is no longer stale and enqueues nothing for it', async () => {
      productsService.getVariant.mockResolvedValueOnce(makeVariant({ isStale: false }));

      const result = await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(identifierMapping.getExternalIds).not.toHaveBeenCalled();
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(result).toEqual({
        variantsConsidered: 1,
        variantsStillStale: 0,
        offersPaused: 0,
        offersSkipped: 0,
      });
    });

    it('fans out across multiple connections with the right connectionId per job', async () => {
      identifierMapping.getExternalIds.mockResolvedValueOnce([
        mapping({ connectionId: 'conn-1', externalId: 'offer-1' }),
        mapping({ connectionId: 'conn-2', externalId: 'offer-2' }),
      ]);

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
      });
    });

    it('stamps the variant staleAt as the payload observedAt (#2285)', async () => {
      identifierMapping.getExternalIds.mockResolvedValueOnce([
        mapping({ connectionId: 'conn-1', externalId: 'offer-1' }),
      ]);

      await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            observedAt: '2026-07-01T00:00:00.000Z',
          }),
        })
      );
    });

    it('composes the dedupe key from connectionId, externalOfferId, and staleAt', async () => {
      identifierMapping.getExternalIds.mockResolvedValueOnce([
        mapping({ connectionId: 'conn-1', externalId: 'offer-1' }),
      ]);

      await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          options: {
            dedupeKey: 'stale-pause:conn-1:offer-1:2026-07-01T00:00:00.000Z',
          },
        })
      );
    });

    it('isolates a single enqueue failure — the other mapping still enqueues and the failure is counted', async () => {
      identifierMapping.getExternalIds.mockResolvedValueOnce([
        mapping({ connectionId: 'conn-1', externalId: 'offer-1' }),
        mapping({ connectionId: 'conn-2', externalId: 'offer-2' }),
      ]);
      jobQueue.enqueue.mockRejectedValueOnce(new Error('redis unavailable'));

      const result = await service.pauseOffersForVariants({
        variantIds: ['ol_variant_a'],
        correlationId: 'corr-1',
      });

      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        variantsConsidered: 1,
        variantsStillStale: 1,
        offersPaused: 1,
        offersSkipped: 1,
      });
    });
  });

  describe('sweepConnection', () => {
    it('pages stale-mapped variants and re-asserts a quantity-0 pause for each', async () => {
      const rows: StaleMappedVariant[] = [
        {
          variantId: 'ol_variant_a',
          externalOfferId: 'offer-1',
          staleAt: new Date('2026-07-01T00:00:00.000Z'),
        },
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
      expect(result).toEqual({
        variantsConsidered: 2,
        variantsStillStale: 2,
        offersPaused: 2,
        offersSkipped: 0,
      });
    });

    it('enqueues nothing for an unchanged (empty) stale set', async () => {
      const result = await service.sweepConnection('conn-1', { limit: 200 });

      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(result).toEqual({
        variantsConsidered: 0,
        variantsStillStale: 0,
        offersPaused: 0,
        offersSkipped: 0,
      });
    });
  });
});
