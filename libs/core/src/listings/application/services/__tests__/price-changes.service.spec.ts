/**
 * Price Changes Service tests (#3145, ADR-072)
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import { PriceChangesService } from '../price-changes.service';
import { PriceChangeEpisode } from '../../../domain/entities/price-change-episode.entity';
import { PriceChangeEpisodeNotFoundException } from '../../../domain/exceptions/price-change-episode-not-found.exception';
import { PriceChangeEpisodeAlreadyResolvedException } from '../../../domain/exceptions/price-change-episode-already-resolved.exception';
import { PriceChangeEpisodeStaleException } from '../../../domain/exceptions/price-change-episode-stale.exception';
import { PriceChangeEpisodeBlockedException } from '../../../domain/exceptions/price-change-episode-blocked.exception';

const DEST_ID = 'dest-1';
const SRC_ID = 'src-1';

function buildConnection(config: Record<string, unknown> = {}): Connection {
  return new Connection(
    DEST_ID,
    'allegro',
    'Allegro — PL',
    'active',
    config,
    'ref',
    new Date(),
    new Date(),
    undefined,
    []
  );
}

function buildEpisode(overrides: Partial<PriceChangeEpisode> = {}): PriceChangeEpisode {
  const base = {
    id: 'ep-1',
    productVariantId: 'ol_variant_1',
    destinationConnectionId: DEST_ID,
    sourceConnectionId: SRC_ID,
    sourceCurrency: 'PLN',
    sourceOldAmount: 350,
    sourceNewAmount: 327,
    computedOldAmount: 427,
    computedNewAmount: 399,
    manualPriceOverride: null,
    manualPriceOverrideSetAt: null,
    blockReason: null as string | null,
    detectedAt: new Date('2026-09-10T10:00:00.000Z'),
    refreshedAt: null,
    resolvedAt: null,
    resolution: null,
    resolvedByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  return new PriceChangeEpisode(
    base.id,
    base.productVariantId,
    base.destinationConnectionId,
    base.sourceConnectionId,
    base.sourceCurrency,
    base.sourceOldAmount,
    base.sourceNewAmount,
    base.computedOldAmount,
    base.computedNewAmount,
    base.manualPriceOverride,
    base.manualPriceOverrideSetAt,
    base.blockReason as never,
    base.detectedAt,
    base.refreshedAt,
    base.resolvedAt,
    base.resolution,
    base.resolvedByUserId,
    base.createdAt,
    base.updatedAt
  );
}

describe('PriceChangesService', () => {
  let episodes: {
    findById: jest.Mock;
    findOpenAll: jest.Mock;
    findOpenForConnection: jest.Mock;
    countOpen: jest.Mock;
    resolve: jest.Mock;
    reopenIgnored: jest.Mock;
  };
  let autoAppliedLog: { findRecent: jest.Mock };
  let bulkBatches: { create: jest.Mock };
  let connections: { get: jest.Mock; update: jest.Mock };
  let productsService: { getVariantsByIds: jest.Mock; getProductsByIds: jest.Mock };
  let jobEnqueue: { enqueueJob: jest.Mock };
  let service: PriceChangesService;

  beforeEach(() => {
    episodes = {
      findById: jest.fn().mockResolvedValue(buildEpisode()),
      findOpenAll: jest.fn().mockResolvedValue([]),
      findOpenForConnection: jest.fn().mockResolvedValue([]),
      countOpen: jest.fn().mockResolvedValue(0),
      resolve: jest.fn().mockResolvedValue(true),
      reopenIgnored: jest.fn().mockResolvedValue(true),
    };
    autoAppliedLog = { findRecent: jest.fn().mockResolvedValue([]) };
    bulkBatches = { create: jest.fn().mockResolvedValue({ id: 'batch-1' }) };
    connections = {
      get: jest.fn().mockResolvedValue(buildConnection()),
      update: jest.fn().mockResolvedValue(undefined),
    };
    productsService = {
      getVariantsByIds: jest.fn().mockResolvedValue([]),
      getProductsByIds: jest.fn().mockResolvedValue([]),
    };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1', isExisting: false }) };

    service = new PriceChangesService(
      episodes as never,
      autoAppliedLog as never,
      bulkBatches as never,
      connections as never,
      productsService as never,
      jobEnqueue as never
    );
  });

  describe('accept', () => {
    it('enqueues the apply job with the computed amount', async () => {
      await service.accept('ep-1', { resolvedByUserId: 'user-1' });

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: 'pricing.propagateToMarketplaces',
          connectionId: DEST_ID,
          payload: expect.objectContaining({
            amount: 399,
            episodeId: 'ep-1',
            manualPriceOverride: false,
            resolvedByUserId: 'user-1',
          }),
        })
      );
    });

    it('opts the source into automatic mode when requested', async () => {
      await service.accept('ep-1', { resolvedByUserId: 'user-1', optInAutomatic: true });

      expect(connections.update).toHaveBeenCalledWith(
        DEST_ID,
        expect.objectContaining({
          config: expect.objectContaining({
            priceSyncMode: { default: 'manual', sourceOverrides: { [SRC_ID]: 'automatic' } },
          }),
        })
      );
    });

    it('throws NotFound for an unknown episode', async () => {
      episodes.findById.mockResolvedValue(null);
      await expect(service.accept('missing', { resolvedByUserId: 'u' })).rejects.toBeInstanceOf(
        PriceChangeEpisodeNotFoundException
      );
    });

    it('throws AlreadyResolved for a resolved episode', async () => {
      episodes.findById.mockResolvedValue(buildEpisode({ resolvedAt: new Date() }));
      await expect(service.accept('ep-1', { resolvedByUserId: 'u' })).rejects.toBeInstanceOf(
        PriceChangeEpisodeAlreadyResolvedException
      );
    });

    it('throws Blocked for a blocked episode', async () => {
      episodes.findById.mockResolvedValue(buildEpisode({ blockReason: 'currency-mismatch' }));
      await expect(service.accept('ep-1', { resolvedByUserId: 'u' })).rejects.toBeInstanceOf(
        PriceChangeEpisodeBlockedException
      );
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('rejects a stale expectedVersion rather than silently applying it', async () => {
      const episode = buildEpisode();
      episodes.findById.mockResolvedValue(episode);

      await expect(
        service.accept('ep-1', { resolvedByUserId: 'u', expectedVersion: '2020-01-01T00:00:00.000Z' })
      ).rejects.toBeInstanceOf(PriceChangeEpisodeStaleException);
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('accepts a matching expectedVersion', async () => {
      const episode = buildEpisode();
      episodes.findById.mockResolvedValue(episode);

      await service.accept('ep-1', {
        resolvedByUserId: 'u',
        expectedVersion: episode.detectedAt.toISOString(),
      });
      expect(jobEnqueue.enqueueJob).toHaveBeenCalled();
    });
  });

  describe('edit', () => {
    it('enqueues the manual override amount', async () => {
      await service.edit('ep-1', { manualPriceOverride: 420, resolvedByUserId: 'user-1' });

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ amount: 420, manualPriceOverride: true }),
        })
      );
    });
  });

  describe('ignore / unresolve', () => {
    it('resolves the episode as ignored', async () => {
      await service.ignore('ep-1', 'user-1');
      expect(episodes.resolve).toHaveBeenCalledWith('ep-1', 'ignored', 'user-1', null, expect.any(Date));
    });

    it('re-opens an ignored episode', async () => {
      await service.unresolve('ep-1');
      expect(episodes.reopenIgnored).toHaveBeenCalledWith('ep-1');
    });

    it('throws NotFound when unresolve targets an unknown episode', async () => {
      episodes.reopenIgnored.mockResolvedValue(false);
      episodes.findById.mockResolvedValue(null);
      await expect(service.unresolve('missing')).rejects.toBeInstanceOf(
        PriceChangeEpisodeNotFoundException
      );
    });
  });

  describe('bulkAccept', () => {
    it('creates one batch and enqueues one job per item, carrying the batchId', async () => {
      episodes.findById.mockImplementation((id: string) =>
        Promise.resolve(buildEpisode({ id }))
      );

      const result = await service.bulkAccept([{ id: 'ep-1' }, { id: 'ep-2' }], 'user-1');

      expect(result).toEqual({ batchId: 'batch-1', totalCount: 2 });
      expect(bulkBatches.create).toHaveBeenCalledWith(
        expect.objectContaining({ totalCount: 2, initiatedBy: 'user-1' })
      );
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ batchId: 'batch-1' }) })
      );
    });
  });

  describe('listOpen', () => {
    it('excludes stale variants and reports hiddenStaleCount', async () => {
      episodes.findOpenAll.mockResolvedValue([
        buildEpisode({ id: 'ep-1', productVariantId: 'v1' }),
        buildEpisode({ id: 'ep-2', productVariantId: 'v2' }),
      ]);
      productsService.getVariantsByIds.mockResolvedValue([
        { id: 'v1', productId: 'p1', sku: 'sku-1', attributes: null, isStale: false },
        { id: 'v2', productId: 'p1', sku: 'sku-2', attributes: null, isStale: true },
      ]);
      productsService.getProductsByIds.mockResolvedValue([{ id: 'p1', name: 'Chair' }]);

      const page = await service.listOpen({});

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe('ep-1');
      expect(page.hiddenStaleCount).toBe(1);
    });
  });
});
