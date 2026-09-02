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
  let productsService: jest.Mocked<Pick<IProductsService, 'getVariant'>>;
  let offerMappings: jest.Mocked<OfferMappingRepositoryPort>;
  let jobQueue: jest.Mocked<SyncJobQueuePort>;
  let service: StaleOfferPauseService;

  beforeEach(() => {
    identifierMapping = {
      getExternalIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    productsService = {
      getVariant: jest.fn().mockResolvedValue(makeVariant()),
    };

    offerMappings = {
      findById: jest.fn(),
      findMany: jest.fn(),
      findMappingPage: jest.fn(),
      countByLifecycle: jest.fn(),
      countByConnectionAndVariants: jest.fn(),
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
      jobQueue
    );
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
