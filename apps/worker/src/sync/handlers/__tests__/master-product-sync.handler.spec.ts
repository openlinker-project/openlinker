/**
 * Master Product Sync Handler Tests
 *
 * Covers the ADR-007 status/outcome mapping added in #1599: a master-side
 * deletion (`masterDeleted: true`) yields a terminal `business_failure`
 * (not retried), a normal sync yields `ok`, and a transient service error
 * still wraps in a retryable `SyncJobExecutionError`.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MasterProductSyncHandler } from '../master-product-sync.handler';
import type {
  IMasterProductSyncService,
  MasterProductSyncResult,
  MasterTaxRateChange,
} from '@openlinker/core/products';
import type {
  JobEnqueuePort,
  SyncJobEntity as SyncJob,
  SyncJobRepositoryPort,
  RetryClassifierRegistryService,
} from '@openlinker/core/sync';
import type { IdentifierMappingQueryPort } from '@openlinker/core/identifier-mapping';
import { ContendedWriteError, SyncJobExecutionError } from '@openlinker/core/sync';

describe('MasterProductSyncHandler', () => {
  let handler: MasterProductSyncHandler;
  let masterProductSync: jest.Mocked<IMasterProductSyncService>;
  let jobEnqueue: { enqueueJob: jest.Mock };
  let identifierMapping: { getExternalIds: jest.Mock };
  let jobRepository: {
    claimQueuedPeers: jest.Mock;
    markSucceeded: jest.Mock;
    markFailed: jest.Mock;
    markDead: jest.Mock;
    requeueWithoutPenalty: jest.Mock;
  };

  let retryRegistry: { isNonRetryable: jest.Mock; resolveRetryDeferral: jest.Mock };

  beforeEach(() => {
    retryRegistry = {
      isNonRetryable: jest.fn().mockReturnValue(false),
      resolveRetryDeferral: jest.fn().mockReturnValue(null),
    };
    masterProductSync = {
      syncFromMasterByExternalId: jest.fn(),
      syncFromMasterByExternalIds: jest.fn(),
      markProductDeletedAtMaster: jest.fn(),
    };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'child-1' }) };
    identifierMapping = { getExternalIds: jest.fn().mockResolvedValue([]) };
    jobRepository = {
      claimQueuedPeers: jest.fn().mockResolvedValue([]),
      markSucceeded: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      markDead: jest.fn().mockResolvedValue(undefined),
      requeueWithoutPenalty: jest.fn().mockResolvedValue(undefined),
    };
    handler = new MasterProductSyncHandler(
      masterProductSync,
      jobEnqueue as unknown as JobEnqueuePort,
      identifierMapping as unknown as IdentifierMappingQueryPort,
      jobRepository as unknown as SyncJobRepositoryPort,
      retryRegistry as unknown as RetryClassifierRegistryService
    );
  });

  const createJob = (): SyncJob =>
    ({
      id: 'job-1',
      jobType: 'master.product.syncByExternalId',
      connectionId: 'conn-1',
      payload: { schemaVersion: 1, externalId: 'ext-9', objectType: 'Product' },
      idempotencyKey: 'key',
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      nextRunAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as unknown as SyncJob;

  const result = (
    masterDeleted: boolean,
    pruneSkipped = false,
    taxRateChanges: readonly MasterTaxRateChange[] = []
  ): MasterProductSyncResult => ({
    internalProductId: 'ol_product_abc',
    variantsUpserted: masterDeleted ? 0 : 2,
    pruneSkippedReason: pruneSkipped ? 'rival' : null,
    masterDeleted,
    pruneSkipped,
    taxRateChanges,
    priceChangeObserverFailures: 0,
  });

  it('returns outcome=ok for a normal sync', async () => {
    masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(result(false));

    await expect(handler.execute(createJob())).resolves.toEqual({ outcome: 'ok' });
  });

  it('returns outcome=business_failure with outcomeReason=master_deleted when the product was deleted at the master', async () => {
    masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(result(true));

    await expect(handler.execute(createJob())).resolves.toEqual({
      outcome: 'business_failure',
      outcomeReason: 'master_deleted',
    });
  });

  // A withheld prune (#1904) is an operator-attention condition, not a business
  // outcome - the upserts still succeeded, so the job stays ok.
  it('keeps outcome=ok when the staleness prune was skipped for a rival-claimed product id', async () => {
    masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(result(false, true));

    await expect(handler.execute(createJob())).resolves.toEqual({ outcome: 'ok' });
  });

  it('wraps a transient service error in a retryable SyncJobExecutionError', async () => {
    masterProductSync.syncFromMasterByExternalId.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(handler.execute(createJob())).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  describe('tax-rate propagation onto published offers (#2263, ADR-063)', () => {
    const change: MasterTaxRateChange = { variantId: 'ol_variant_1', taxRate: '23' };

    it('enqueues one rate-only field update per mapped marketplace offer', async () => {
      masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(
        result(false, false, [change])
      );
      identifierMapping.getExternalIds.mockResolvedValueOnce([
        {
          externalId: 'offer-a',
          connectionId: 'conn-allegro',
          entityType: 'Offer',
          platformType: 'allegro',
        },
        {
          externalId: 'offer-b',
          connectionId: 'conn-erli',
          entityType: 'Offer',
          platformType: 'erli',
        },
      ]);

      await expect(handler.execute(createJob())).resolves.toEqual({ outcome: 'ok' });

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith({
        jobType: 'marketplace.offer.updateFields',
        connectionId: 'conn-allegro',
        payload: { schemaVersion: 1, offerId: 'ol_variant_1', fields: { taxRate: '23' } },
        idempotencyKey: 'taxrate:conn-allegro:ol_variant_1:23',
      });
    });

    it('keys the job by the RATE so a repeat dedups and a new rate gets through', async () => {
      // The sweep runs every twenty minutes; a run-scoped key would enqueue an
      // outbound marketplace write per product per tick (#2039).
      masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(
        result(false, false, [{ variantId: 'ol_variant_1', taxRate: '5' }])
      );
      identifierMapping.getExternalIds.mockResolvedValueOnce([
        {
          externalId: 'offer-a',
          connectionId: 'conn-allegro',
          entityType: 'Offer',
          platformType: 'allegro',
        },
      ]);

      await handler.execute(createJob());

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'taxrate:conn-allegro:ol_variant_1:5' })
      );
    });

    it('never targets the master connection the sync ran against', async () => {
      masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(
        result(false, false, [change])
      );
      identifierMapping.getExternalIds.mockResolvedValueOnce([
        {
          externalId: 'offer-a',
          connectionId: 'conn-1',
          entityType: 'Offer',
          platformType: 'prestashop',
        },
      ]);

      await handler.execute(createJob());

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('enqueues nothing when the sync observed no change', async () => {
      masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(result(false));

      await handler.execute(createJob());

      expect(identifierMapping.getExternalIds).not.toHaveBeenCalled();
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('keeps the sync ok when the propagation enqueue fails', async () => {
      // The catalogue rate is already stored; the next change re-enqueues.
      masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(
        result(false, false, [change])
      );
      identifierMapping.getExternalIds.mockResolvedValueOnce([
        {
          externalId: 'offer-a',
          connectionId: 'conn-allegro',
          entityType: 'Offer',
          platformType: 'allegro',
        },
      ]);
      jobEnqueue.enqueueJob.mockRejectedValueOnce(new Error('queue down'));

      await expect(handler.execute(createJob())).resolves.toEqual({ outcome: 'ok' });
    });

    it('keeps the sync ok when the offer-mapping read fails', async () => {
      masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(
        result(false, false, [change])
      );
      identifierMapping.getExternalIds.mockRejectedValueOnce(new Error('db down'));

      await expect(handler.execute(createJob())).resolves.toEqual({ outcome: 'ok' });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('propagates nothing for a product deleted at the master', async () => {
      masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(result(true));

      await handler.execute(createJob());

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });
  });

  describe('drain-claim batching (#3986)', () => {
    const claimerJob = (): SyncJob => ({ ...createJob(), lockedBy: 'worker-1' }) as SyncJob;
    const peer = (id: string, externalId: string, attempts = 0): SyncJob =>
      ({
        ...createJob(),
        id,
        attempts,
        lockedBy: 'worker-1',
        payload: { schemaVersion: 1, externalId, objectType: 'Product' },
      }) as SyncJob;

    it('should process only its own job when the peer claim finds nothing', async () => {
      masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(result(false));

      await expect(handler.execute(claimerJob())).resolves.toEqual({ outcome: 'ok' });
      expect(masterProductSync.syncFromMasterByExternalIds).not.toHaveBeenCalled();
    });

    it('should fall back to its own job when the peer claim throws', async () => {
      jobRepository.claimQueuedPeers.mockRejectedValueOnce(new Error('db down'));
      masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(result(false));

      await expect(handler.execute(claimerJob())).resolves.toEqual({ outcome: 'ok' });
      expect(masterProductSync.syncFromMasterByExternalIds).not.toHaveBeenCalled();
    });

    it('should de-duplicate ids, sync once and mark every claimed peer succeeded', async () => {
      jobRepository.claimQueuedPeers.mockResolvedValueOnce([
        peer('p1', 'ext-1'),
        peer('p2', 'ext-1'),
        peer('p3', 'ext-9'),
      ]);
      masterProductSync.syncFromMasterByExternalIds.mockResolvedValueOnce({
        results: [result(false), result(false)],
        failures: [],
        prefetched: true,
      });

      await expect(handler.execute(claimerJob())).resolves.toEqual({ outcome: 'ok' });

      expect(masterProductSync.syncFromMasterByExternalIds).toHaveBeenCalledWith('conn-1', [
        'ext-9',
        'ext-1',
      ]);
      expect(jobRepository.markSucceeded).toHaveBeenCalledTimes(3);
    });

    it('should put a failed peer on its own retry ladder and not fail the claimer', async () => {
      jobRepository.claimQueuedPeers.mockResolvedValueOnce([peer('p1', 'ext-1')]);
      masterProductSync.syncFromMasterByExternalIds.mockResolvedValueOnce({
        results: [result(false)],
        failures: [{ externalId: 'ext-1', message: 'boom' }],
        prefetched: false,
      });

      await expect(handler.execute(claimerJob())).resolves.toEqual({ outcome: 'ok' });
      expect(jobRepository.markFailed).toHaveBeenCalledWith(
        'p1',
        'boom',
        expect.any(Date),
        expect.any(Number)
      );
      expect(jobRepository.markSucceeded).not.toHaveBeenCalled();
    });

    it('should mark a failed peer dead when its attempts are exhausted', async () => {
      jobRepository.claimQueuedPeers.mockResolvedValueOnce([peer('p1', 'ext-1', 2)]);
      masterProductSync.syncFromMasterByExternalIds.mockResolvedValueOnce({
        results: [result(false)],
        failures: [{ externalId: 'ext-1', message: 'boom' }],
        prefetched: false,
      });

      await handler.execute(claimerJob());
      expect(jobRepository.markDead).toHaveBeenCalledWith('p1', 'boom', expect.any(Number));
    });

    it('should mark a peer dead at once when its original error is non-retryable', async () => {
      const credError = new Error('invalid_grant');
      retryRegistry.isNonRetryable.mockImplementation((e: unknown) => e === credError);
      jobRepository.claimQueuedPeers.mockResolvedValueOnce([peer('p1', 'ext-1')]);
      masterProductSync.syncFromMasterByExternalIds.mockResolvedValueOnce({
        results: [result(false)],
        failures: [{ externalId: 'ext-1', message: 'invalid_grant', error: credError }],
        prefetched: false,
      });

      await handler.execute(claimerJob());

      expect(jobRepository.markDead).toHaveBeenCalledWith(
        'p1',
        'invalid_grant',
        expect.any(Number)
      );
      expect(jobRepository.markFailed).not.toHaveBeenCalled();
    });

    it('should requeue a throttled peer without penalty and charge the deferral budget', async () => {
      const throttled = new Error('429');
      retryRegistry.resolveRetryDeferral.mockImplementation((e: unknown) =>
        e === throttled ? { delaySeconds: 60, reason: 'Throttled' } : null
      );
      jobRepository.claimQueuedPeers.mockResolvedValueOnce([peer('p1', 'ext-1')]);
      masterProductSync.syncFromMasterByExternalIds.mockResolvedValueOnce({
        results: [result(false)],
        failures: [{ externalId: 'ext-1', message: '429', error: throttled }],
        prefetched: false,
      });

      await handler.execute(claimerJob());

      expect(jobRepository.requeueWithoutPenalty).toHaveBeenCalledWith(
        'p1',
        expect.stringContaining('Throttled'),
        expect.any(Date),
        expect.objectContaining({ deferredTotalMs: 60_000 })
      );
      expect(jobRepository.markFailed).not.toHaveBeenCalled();
    });

    it('should requeue a contended-write peer without penalty', async () => {
      const contended = new ContendedWriteError('busy', 'offer-1');
      jobRepository.claimQueuedPeers.mockResolvedValueOnce([peer('p1', 'ext-1')]);
      masterProductSync.syncFromMasterByExternalIds.mockResolvedValueOnce({
        results: [result(false)],
        failures: [{ externalId: 'ext-1', message: 'busy', error: contended }],
        prefetched: false,
      });

      await handler.execute(claimerJob());

      expect(jobRepository.requeueWithoutPenalty).toHaveBeenCalledTimes(1);
      expect(jobRepository.markFailed).not.toHaveBeenCalled();
    });

    it('should fall back to the ladder once the peer deferral budget is spent', async () => {
      retryRegistry.resolveRetryDeferral.mockReturnValue({ delaySeconds: 60, reason: 'Throttled' });
      const spent = { ...peer('p1', 'ext-1'), deferredTotalMs: 24 * 60 * 60 * 1000 } as SyncJob;
      jobRepository.claimQueuedPeers.mockResolvedValueOnce([spent]);
      masterProductSync.syncFromMasterByExternalIds.mockResolvedValueOnce({
        results: [result(false)],
        failures: [{ externalId: 'ext-1', message: '429', error: new Error('429') }],
        prefetched: false,
      });

      await handler.execute(claimerJob());

      expect(jobRepository.requeueWithoutPenalty).not.toHaveBeenCalled();
      expect(jobRepository.markFailed).toHaveBeenCalledTimes(1);
    });

    it('should carry the original error as cause when its own drained product fails', async () => {
      const original = new Error('503 from shop');
      jobRepository.claimQueuedPeers.mockResolvedValueOnce([peer('p1', 'ext-1')]);
      masterProductSync.syncFromMasterByExternalIds.mockResolvedValueOnce({
        results: [result(false)],
        failures: [{ externalId: 'ext-9', message: '503 from shop', error: original }],
        prefetched: false,
      });

      const thrown = await handler.execute(claimerJob()).catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(SyncJobExecutionError);
      expect((thrown as SyncJobExecutionError).cause).toBe(original);
    });

    it('should throw for its own failed id while still settling the peers', async () => {
      jobRepository.claimQueuedPeers.mockResolvedValueOnce([peer('p1', 'ext-1')]);
      masterProductSync.syncFromMasterByExternalIds.mockResolvedValueOnce({
        results: [result(false)],
        failures: [{ externalId: 'ext-9', message: 'boom' }],
        prefetched: false,
      });

      await expect(handler.execute(claimerJob())).rejects.toBeInstanceOf(SyncJobExecutionError);
      expect(jobRepository.markSucceeded).toHaveBeenCalledWith('p1', 'ok');
    });

    it('should release the peers without penalty when the whole batch throws', async () => {
      jobRepository.claimQueuedPeers.mockResolvedValueOnce([peer('p1', 'ext-1')]);
      masterProductSync.syncFromMasterByExternalIds.mockRejectedValueOnce(new Error('creds'));

      await expect(handler.execute(claimerJob())).rejects.toBeInstanceOf(SyncJobExecutionError);
      expect(jobRepository.requeueWithoutPenalty).toHaveBeenCalledWith(
        'p1',
        expect.any(String),
        expect.any(Date)
      );
    });
  });
});
