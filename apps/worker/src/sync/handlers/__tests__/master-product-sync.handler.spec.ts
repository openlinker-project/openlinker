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
import type { JobEnqueuePort, SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import type { IdentifierMappingQueryPort } from '@openlinker/core/identifier-mapping';
import { SyncJobExecutionError } from '@openlinker/core/sync';

describe('MasterProductSyncHandler', () => {
  let handler: MasterProductSyncHandler;
  let masterProductSync: jest.Mocked<IMasterProductSyncService>;
  let jobEnqueue: { enqueueJob: jest.Mock };
  let identifierMapping: { getExternalIds: jest.Mock };

  beforeEach(() => {
    masterProductSync = {
      syncFromMasterByExternalId: jest.fn(),
      markProductDeletedAtMaster: jest.fn(),
    };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'child-1' }) };
    identifierMapping = { getExternalIds: jest.fn().mockResolvedValue([]) };
    handler = new MasterProductSyncHandler(
      masterProductSync,
      jobEnqueue as unknown as JobEnqueuePort,
      identifierMapping as unknown as IdentifierMappingQueryPort,
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
    taxRateChanges: readonly MasterTaxRateChange[] = [],
  ): MasterProductSyncResult => ({
    internalProductId: 'ol_product_abc',
    variantsUpserted: masterDeleted ? 0 : 2,
    pruneSkippedReason: pruneSkipped ? 'rival' : null,
    masterDeleted,
    pruneSkipped,
    taxRateChanges,
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
        result(false, false, [change]),
      );
      identifierMapping.getExternalIds.mockResolvedValueOnce([
        { externalId: 'offer-a', connectionId: 'conn-allegro', entityType: 'Offer', platformType: 'allegro' },
        { externalId: 'offer-b', connectionId: 'conn-erli', entityType: 'Offer', platformType: 'erli' },
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
        result(false, false, [{ variantId: 'ol_variant_1', taxRate: '5' }]),
      );
      identifierMapping.getExternalIds.mockResolvedValueOnce([
        { externalId: 'offer-a', connectionId: 'conn-allegro', entityType: 'Offer', platformType: 'allegro' },
      ]);

      await handler.execute(createJob());

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'taxrate:conn-allegro:ol_variant_1:5' }),
      );
    });

    it('never targets the master connection the sync ran against', async () => {
      masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(
        result(false, false, [change]),
      );
      identifierMapping.getExternalIds.mockResolvedValueOnce([
        { externalId: 'offer-a', connectionId: 'conn-1', entityType: 'Offer', platformType: 'prestashop' },
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
        result(false, false, [change]),
      );
      identifierMapping.getExternalIds.mockResolvedValueOnce([
        { externalId: 'offer-a', connectionId: 'conn-allegro', entityType: 'Offer', platformType: 'allegro' },
      ]);
      jobEnqueue.enqueueJob.mockRejectedValueOnce(new Error('queue down'));

      await expect(handler.execute(createJob())).resolves.toEqual({ outcome: 'ok' });
    });

    it('keeps the sync ok when the offer-mapping read fails', async () => {
      masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(
        result(false, false, [change]),
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
});
