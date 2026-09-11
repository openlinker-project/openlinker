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

function buildBatch(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'batch-1',
    connectionId: DEST_ID,
    initiatedBy: 'user-1',
    status: 'pending',
    totalCount: 0,
    succeededCount: 0,
    failedCount: 0,
    sharedConfig: { kind: 'price-change' },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PriceChangesService', () => {
  let episodes: {
    findById: jest.Mock;
    findByIds: jest.Mock;
    findOpenAll: jest.Mock;
    findOpenForConnection: jest.Mock;
    countOpen: jest.Mock;
    resolve: jest.Mock;
    reopenIgnored: jest.Mock;
    acknowledgeRefresh: jest.Mock;
  };
  let autoAppliedLog: { findRecent: jest.Mock };
  let bulkBatches: {
    create: jest.Mock;
    updateStatus: jest.Mock;
    updateTotalCount: jest.Mock;
  };
  let connections: { get: jest.Mock; list: jest.Mock; update: jest.Mock };
  let productsService: { getVariantsByIds: jest.Mock; getProductsByIds: jest.Mock };
  let jobEnqueue: { enqueueJob: jest.Mock };
  let service: PriceChangesService;

  beforeEach(() => {
    episodes = {
      findById: jest.fn().mockResolvedValue(buildEpisode()),
      findByIds: jest.fn().mockImplementation((ids: string[]) =>
        Promise.resolve(ids.map((id) => buildEpisode({ id })))
      ),
      findOpenAll: jest.fn().mockResolvedValue([]),
      findOpenForConnection: jest.fn().mockResolvedValue([]),
      countOpen: jest.fn().mockResolvedValue(0),
      resolve: jest.fn().mockResolvedValue(true),
      reopenIgnored: jest.fn().mockResolvedValue(true),
      acknowledgeRefresh: jest.fn().mockResolvedValue(buildEpisode({ refreshedAt: null })),
    };
    autoAppliedLog = { findRecent: jest.fn().mockResolvedValue([]) };
    bulkBatches = {
      create: jest.fn().mockResolvedValue(buildBatch()),
      updateStatus: jest.fn().mockImplementation((id: string, status: string) =>
        Promise.resolve(buildBatch({ id, status }))
      ),
      updateTotalCount: jest.fn().mockImplementation((id: string, totalCount: number) =>
        Promise.resolve(buildBatch({ id, totalCount }))
      ),
    };
    connections = {
      get: jest.fn().mockResolvedValue(buildConnection()),
      list: jest.fn().mockResolvedValue([buildConnection()]),
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

    it('never writes Connection.config itself — reports the opt-in pair instead', async () => {
      const result = await service.accept('ep-1', {
        resolvedByUserId: 'user-1',
        optInAutomatic: true,
      });

      expect(connections.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        optInPair: { destinationConnectionId: DEST_ID, sourceConnectionId: SRC_ID },
      });
    });

    it('reports no opt-in pair when optInAutomatic was not requested', async () => {
      const result = await service.accept('ep-1', { resolvedByUserId: 'user-1' });
      expect(result).toEqual({});
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

  describe('ignore / unresolve / refresh', () => {
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

    it('propagates PriceChangeEpisodeSupersededError from reopenIgnored unchanged', async () => {
      class FakeSupersededError extends Error {}
      episodes.reopenIgnored.mockRejectedValue(new FakeSupersededError('superseded'));
      await expect(service.unresolve('ep-1')).rejects.toBeInstanceOf(FakeSupersededError);
    });

    it('clears the refreshedAt marker via acknowledgeRefresh and returns the current row', async () => {
      episodes.acknowledgeRefresh.mockResolvedValue(buildEpisode({ refreshedAt: null }));
      const item = await service.refresh('ep-1');
      expect(episodes.acknowledgeRefresh).toHaveBeenCalledWith('ep-1');
      expect(item.needsRefresh).toBe(false);
    });

    it('throws NotFound when refresh targets an unknown episode', async () => {
      episodes.acknowledgeRefresh.mockResolvedValue(null);
      episodes.findById.mockResolvedValue(null);
      await expect(service.refresh('missing')).rejects.toBeInstanceOf(
        PriceChangeEpisodeNotFoundException
      );
    });

    it('throws AlreadyResolved when refresh targets a resolved episode', async () => {
      episodes.acknowledgeRefresh.mockResolvedValue(null);
      episodes.findById.mockResolvedValue(buildEpisode({ resolvedAt: new Date() }));
      await expect(service.refresh('ep-1')).rejects.toBeInstanceOf(
        PriceChangeEpisodeAlreadyResolvedException
      );
    });
  });

  describe('bulkAccept', () => {
    it('creates one batch, enqueues one job per item carrying the batchId, and reaches running', async () => {
      const result = await service.bulkAccept([{ id: 'ep-1' }, { id: 'ep-2' }], 'user-1');

      expect(episodes.findByIds).toHaveBeenCalledWith(['ep-1', 'ep-2']);
      expect(result.batchId).toBe('batch-1');
      expect(result.totalCount).toBe(2);
      expect(bulkBatches.create).toHaveBeenCalledWith(
        expect.objectContaining({ totalCount: 2, initiatedBy: 'user-1' })
      );
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ batchId: 'batch-1' }) })
      );
      // #3162 review — the batch previously never left `pending`.
      expect(bulkBatches.updateStatus).toHaveBeenCalledWith('batch-1', 'running');
    });

    it('deduplicates opt-in pairs across items and reports them rather than writing config itself', async () => {
      episodes.findByIds.mockResolvedValue([
        buildEpisode({ id: 'ep-1' }),
        buildEpisode({ id: 'ep-2' }),
      ]);

      const result = await service.bulkAccept(
        [
          { id: 'ep-1', optInAutomatic: true },
          { id: 'ep-2', optInAutomatic: true },
        ],
        'user-1'
      );

      expect(connections.update).not.toHaveBeenCalled();
      expect(result.optInPairs).toEqual([
        { destinationConnectionId: DEST_ID, sourceConnectionId: SRC_ID },
      ]);
    });

    it('applies the staleness guard per item, mirroring the single-accept path', async () => {
      episodes.findByIds.mockResolvedValue([buildEpisode({ id: 'ep-1' })]);

      await expect(
        service.bulkAccept(
          [{ id: 'ep-1', expectedVersion: '2020-01-01T00:00:00.000Z' }],
          'user-1'
        )
      ).rejects.toBeInstanceOf(PriceChangeEpisodeStaleException);
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('throws NotFound for an id absent from the batched read', async () => {
      episodes.findByIds.mockResolvedValue([]);
      await expect(service.bulkAccept([{ id: 'missing' }], 'user-1')).rejects.toBeInstanceOf(
        PriceChangeEpisodeNotFoundException
      );
    });

    it('reconciles totalCount and derives a terminal status on a mid-fan-out enqueue failure', async () => {
      episodes.findByIds.mockResolvedValue([
        buildEpisode({ id: 'ep-1' }),
        buildEpisode({ id: 'ep-2' }),
      ]);
      jobEnqueue.enqueueJob
        .mockResolvedValueOnce({ jobId: 'job-1', isExisting: false })
        .mockRejectedValueOnce(new Error('stream unavailable'));

      await expect(
        service.bulkAccept([{ id: 'ep-1' }, { id: 'ep-2' }], 'user-1')
      ).rejects.toThrow('stream unavailable');

      expect(bulkBatches.updateTotalCount).toHaveBeenCalledWith('batch-1', 1);
      // Both counters at 0 with totalCount reconciled to 1 means not yet
      // finished, so the reconcile path advances to 'running' rather than a
      // terminal status — the #737 counter gate finishes it later.
      expect(bulkBatches.updateStatus).toHaveBeenCalledWith('batch-1', 'running');
    });

    it('flips the batch straight to failed when nothing reached the stream', async () => {
      episodes.findByIds.mockResolvedValue([buildEpisode({ id: 'ep-1' })]);
      jobEnqueue.enqueueJob.mockRejectedValue(new Error('stream unavailable'));

      await expect(service.bulkAccept([{ id: 'ep-1' }], 'user-1')).rejects.toThrow(
        'stream unavailable'
      );

      expect(bulkBatches.updateTotalCount).not.toHaveBeenCalled();
      expect(bulkBatches.updateStatus).toHaveBeenCalledWith('batch-1', 'failed');
    });
  });

  describe('listOpen', () => {
    it('excludes stale variants and reports hiddenStaleCount + total', async () => {
      episodes.findOpenAll.mockResolvedValue([
        buildEpisode({ id: 'ep-1', productVariantId: 'v1' }),
        buildEpisode({ id: 'ep-2', productVariantId: 'v2' }),
      ]);
      episodes.countOpen.mockResolvedValue(2);
      productsService.getVariantsByIds.mockResolvedValue([
        { id: 'v1', productId: 'p1', sku: 'sku-1', attributes: null, isStale: false },
        { id: 'v2', productId: 'p1', sku: 'sku-2', attributes: null, isStale: true },
      ]);
      productsService.getProductsByIds.mockResolvedValue([{ id: 'p1', name: 'Chair' }]);

      const page = await service.listOpen({});

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe('ep-1');
      expect(page.hiddenStaleCount).toBe(1);
      expect(page.total).toBe(2);
    });

    it('passes a bounded page (default limit) down to the repository, plus includeRecentlyResolved', async () => {
      await service.listOpen({});

      expect(episodes.findOpenAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50, offset: 0, includeRecentlyResolved: true })
      );
    });

    it('caps an oversized requested limit rather than passing it straight through', async () => {
      await service.listOpen({ limit: 10_000 });

      expect(episodes.findOpenAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 200 })
      );
    });

    it('batches the connections read instead of one call per distinct id', async () => {
      episodes.findOpenAll.mockResolvedValue([
        buildEpisode({ id: 'ep-1', sourceConnectionId: 'src-a', destinationConnectionId: 'dest-a' }),
        buildEpisode({ id: 'ep-2', sourceConnectionId: 'src-b', destinationConnectionId: 'dest-b' }),
      ]);
      productsService.getVariantsByIds.mockResolvedValue([]);

      await service.listOpen({});

      expect(connections.list).toHaveBeenCalledTimes(1);
      expect(connections.get).not.toHaveBeenCalled();
    });
  });

  describe('listAutoApplied', () => {
    it('enriches each log entry with the product name, variant label, and SKU', async () => {
      autoAppliedLog.findRecent.mockResolvedValue([
        {
          id: 'log-1',
          productVariantId: 'v1',
          destinationConnectionId: 'dest-1',
          sourceConnectionId: 'src-1',
          oldAmount: 34.9,
          newAmount: 36.9,
          currency: 'PLN',
          appliedAt: new Date('2026-09-10T10:00:00.000Z'),
        },
      ]);
      productsService.getVariantsByIds.mockResolvedValue([
        { id: 'v1', productId: 'p1', sku: 'MUG-350', attributes: { size: '350 ml' }, isStale: false },
      ]);
      productsService.getProductsByIds.mockResolvedValue([{ id: 'p1', name: 'Ceramic Coffee Mug' }]);

      const [view] = await service.listAutoApplied(20);

      expect(productsService.getVariantsByIds).toHaveBeenCalledWith(['v1']);
      expect(productsService.getProductsByIds).toHaveBeenCalledWith(['p1']);
      expect(view).toMatchObject({
        id: 'log-1',
        productVariantId: 'v1',
        productName: 'Ceramic Coffee Mug',
        variantLabel: '350 ml',
        sku: 'MUG-350',
      });
    });

    it('short-circuits with no product lookups when the log is empty', async () => {
      autoAppliedLog.findRecent.mockResolvedValue([]);

      const views = await service.listAutoApplied(20);

      expect(views).toEqual([]);
      expect(productsService.getVariantsByIds).not.toHaveBeenCalled();
    });

    it('falls back to "Unknown product" and null label/sku when the variant cannot be resolved', async () => {
      autoAppliedLog.findRecent.mockResolvedValue([
        {
          id: 'log-1',
          productVariantId: 'v-deleted',
          destinationConnectionId: 'dest-1',
          sourceConnectionId: 'src-1',
          oldAmount: 10,
          newAmount: 12,
          currency: 'PLN',
          appliedAt: new Date('2026-09-10T10:00:00.000Z'),
        },
      ]);
      productsService.getVariantsByIds.mockResolvedValue([]);
      productsService.getProductsByIds.mockResolvedValue([]);

      const [view] = await service.listAutoApplied(20);

      expect(view).toMatchObject({ productName: 'Unknown product', variantLabel: null, sku: null });
    });
  });
});
