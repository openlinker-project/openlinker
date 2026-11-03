/**
 * Marketplace Source Fulfillment Status Sync Handler Tests (ADR-012 amendment)
 *
 * Mirrors `marketplace-fulfillment-status-sync.handler.spec.ts`: scan-offset
 * cursor read/parse/advance, default cursor key + limit, ok outcome, error
 * wrapping, and the per-connection sweep lock. The read-back orchestration
 * itself is covered on the core service.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SourceFulfillmentStatusSyncResult } from '@openlinker/core/shipping';

import { MarketplaceSourceFulfillmentStatusSyncHandler } from '../marketplace-source-fulfillment-status-sync.handler';

describe('MarketplaceSourceFulfillmentStatusSyncHandler', () => {
  let handler: MarketplaceSourceFulfillmentStatusSyncHandler;
  let syncLock: { acquire: jest.Mock; release: jest.Mock; extend: jest.Mock };
  let sourceSync: { sync: jest.Mock };
  let cursors: { getCursor: jest.Mock; advanceCursor: jest.Mock };

  const baseResult: SourceFulfillmentStatusSyncResult = {
    scanned: 1,
    created: 1,
    updated: 0,
    relayed: 1,
    skipped: 0,
    failed: 0,
    total: 50,
    nextOffset: 10,
  };

  beforeEach(() => {
    sourceSync = { sync: jest.fn().mockResolvedValue(baseResult) };
    cursors = {
      getCursor: jest.fn().mockResolvedValue(null),
      advanceCursor: jest.fn(),
    };
    syncLock = {
      acquire: jest.fn().mockResolvedValue('lock-token'),
      release: jest.fn().mockResolvedValue(true),
      extend: jest.fn().mockResolvedValue(true),
    };

    handler = new MarketplaceSourceFulfillmentStatusSyncHandler(
      sourceSync as never,
      cursors as never,
      syncLock as never,
      { get: jest.fn().mockReturnValue(undefined) } as never
    );
  });

  const createJob = (payload: Record<string, unknown> | null): SyncJob => ({
    id: 'job-id',
    jobType: 'marketplace.sourceFulfillment.statusSync',
    connectionId: 'connection-1',
    payload: payload as Record<string, unknown>,
    idempotencyKey: 'key',
    status: 'queued',
    attempts: 0,
    maxAttempts: 10,
    nextRunAt: new Date(),
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('should start at offset 0 under the neutral default cursor key when none is stored', async () => {
    const result = await handler.execute(createJob({ schemaVersion: 1, limit: 25 }));

    expect(cursors.getCursor).toHaveBeenCalledWith(
      'connection-1',
      'sourceFulfillmentStatus.scanOffset'
    );
    expect(sourceSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 25,
      offset: 0,
      updatedSinceDays: undefined,
    });
    expect(cursors.advanceCursor).toHaveBeenCalledWith(
      'connection-1',
      'sourceFulfillmentStatus.scanOffset',
      '10'
    );
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('should honour the payload cursorKey, updatedSinceDays and limit', async () => {
    await handler.execute(
      createJob({
        schemaVersion: 1,
        limit: 50,
        cursorKey: 'shoper.sourceFulfillmentStatus.scanOffset',
        updatedSinceDays: 14,
      })
    );

    expect(cursors.getCursor).toHaveBeenCalledWith(
      'connection-1',
      'shoper.sourceFulfillmentStatus.scanOffset'
    );
    expect(sourceSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 50,
      offset: 0,
      updatedSinceDays: 14,
    });
  });

  it('should resume from the stored offset', async () => {
    cursors.getCursor.mockResolvedValue('42');

    await handler.execute(createJob({ schemaVersion: 1, limit: 10 }));

    expect(sourceSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 10,
      offset: 42,
      updatedSinceDays: undefined,
    });
  });

  it('should fall back to the default limit when the payload limit is invalid', async () => {
    await handler.execute(createJob({ schemaVersion: 1, limit: 'bogus' }));

    expect(sourceSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 100,
      offset: 0,
      updatedSinceDays: undefined,
    });
  });

  it('should take its OWN sweep lock, never the destination read-back one', async () => {
    await handler.execute(createJob({ schemaVersion: 1, limit: 10 }));

    expect(syncLock.acquire).toHaveBeenCalledWith(
      'scan:source-fulfillment-status:sweep:connection-1',
      expect.any(Number)
    );
  });

  it('should do nothing and report ok when another run holds the lock', async () => {
    syncLock.acquire.mockResolvedValue(null);

    const result = await handler.execute(createJob({ schemaVersion: 1, limit: 10 }));

    expect(result).toEqual({ outcome: 'ok' });
    expect(sourceSync.sync).not.toHaveBeenCalled();
    expect(cursors.advanceCursor).not.toHaveBeenCalled();
  });

  it('should wrap a service error in SyncJobExecutionError without moving the cursor', async () => {
    sourceSync.sync.mockRejectedValue(new Error('downstream'));

    await expect(handler.execute(createJob({ schemaVersion: 1, limit: 10 }))).rejects.toBeInstanceOf(
      SyncJobExecutionError
    );
    expect(cursors.advanceCursor).not.toHaveBeenCalled();
  });

  it('should throw when the payload is missing', async () => {
    await expect(handler.execute(createJob(null))).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
