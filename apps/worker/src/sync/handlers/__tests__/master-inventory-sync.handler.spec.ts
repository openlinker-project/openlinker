/**
 * Master Inventory Sync Handler Tests
 *
 * Covers the ADR-007 status/outcome mapping added in #1688: a master-side
 * deletion (`masterDeleted: true`) yields a terminal `business_failure`
 * (not retried, mirrors MasterProductSyncHandler / #1599), a normal sync
 * yields `ok`, and a transient service error still wraps in a retryable
 * `SyncJobExecutionError`.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MasterInventorySyncHandler } from '../master-inventory-sync.handler';
import type {
  IMasterInventorySyncService,
  MasterInventorySyncResult,
} from '@openlinker/core/inventory';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';

describe('MasterInventorySyncHandler', () => {
  let handler: MasterInventorySyncHandler;
  let masterInventorySync: jest.Mocked<IMasterInventorySyncService>;

  beforeEach(() => {
    masterInventorySync = {
      syncFromMasterByExternalId: jest.fn(),
      syncFromMasterByExternalIds: jest.fn(),
    };
    handler = new MasterInventorySyncHandler(masterInventorySync);
  });

  const createJob = (): SyncJob =>
    ({
      id: 'job-1',
      jobType: 'master.inventory.syncByExternalId',
      connectionId: 'conn-1',
      payload: { schemaVersion: 1, externalId: 'ext-9', objectType: 'Inventory' },
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

  const result = (masterDeleted: boolean, pruneSkipped = false): MasterInventorySyncResult => ({
    internalProductId: 'ol_product_abc',
    itemsWritten: masterDeleted ? 0 : 2,
    availableQuantity: masterDeleted ? 0 : 10,
    reservedQuantity: masterDeleted ? 0 : 1,
    masterDeleted,
    pruneSkipped,
  });

  it('returns outcome=ok for a normal sync', async () => {
    masterInventorySync.syncFromMasterByExternalId.mockResolvedValueOnce(result(false));

    await expect(handler.execute(createJob())).resolves.toEqual({ outcome: 'ok' });
  });

  it('returns outcome=business_failure when the product was deleted at the master', async () => {
    masterInventorySync.syncFromMasterByExternalId.mockResolvedValueOnce(result(true));

    await expect(handler.execute(createJob())).resolves.toEqual({ outcome: 'business_failure' });
  });

  // A withheld prune (#1904) is an operator-attention condition, not a business
  // outcome - the canonical writes still succeeded, so the job stays ok.
  it('keeps outcome=ok when the staleness prune was skipped for a rival-claimed product id', async () => {
    masterInventorySync.syncFromMasterByExternalId.mockResolvedValueOnce(result(false, true));

    await expect(handler.execute(createJob())).resolves.toEqual({ outcome: 'ok' });
  });

  it('wraps a transient service error in a retryable SyncJobExecutionError', async () => {
    masterInventorySync.syncFromMasterByExternalId.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(handler.execute(createJob())).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
