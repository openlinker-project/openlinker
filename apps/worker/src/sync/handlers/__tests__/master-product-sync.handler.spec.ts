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
import type { IMasterProductSyncService, MasterProductSyncResult } from '@openlinker/core/products';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';

describe('MasterProductSyncHandler', () => {
  let handler: MasterProductSyncHandler;
  let masterProductSync: jest.Mocked<IMasterProductSyncService>;

  beforeEach(() => {
    masterProductSync = {
      syncFromMasterByExternalId: jest.fn(),
    };
    handler = new MasterProductSyncHandler(masterProductSync);
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

  const result = (masterDeleted: boolean): MasterProductSyncResult => ({
    internalProductId: 'ol_product_abc',
    variantsUpserted: masterDeleted ? 0 : 2,
    masterDeleted,
  });

  it('returns outcome=ok for a normal sync', async () => {
    masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(result(false));

    await expect(handler.execute(createJob())).resolves.toEqual({ outcome: 'ok' });
  });

  it('returns outcome=business_failure when the product was deleted at the master', async () => {
    masterProductSync.syncFromMasterByExternalId.mockResolvedValueOnce(result(true));

    await expect(handler.execute(createJob())).resolves.toEqual({ outcome: 'business_failure' });
  });

  it('wraps a transient service error in a retryable SyncJobExecutionError', async () => {
    masterProductSync.syncFromMasterByExternalId.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(handler.execute(createJob())).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
