/**
 * Marketplace Fulfillment Status Sync Handler Tests (#834)
 *
 * Mirrors `marketplace-shipment-status-sync.handler.spec.ts`: scan-offset
 * cursor read/parse/advance, default cursor key + limit, ok outcome, and
 * error wrapping. Doesn't re-cover the projection-only orchestration —
 * that's tested on the core service.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { ConnectionCursorRepositoryPort } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import type { FulfillmentStatusSyncResult } from '@openlinker/core/shipping';

import { MarketplaceFulfillmentStatusSyncHandler } from '../marketplace-fulfillment-status-sync.handler';

describe('MarketplaceFulfillmentStatusSyncHandler', () => {
  let handler: MarketplaceFulfillmentStatusSyncHandler;
  type FulfillmentStatusSyncServiceLike = { sync: jest.Mock };
  let fulfillmentStatusSync: FulfillmentStatusSyncServiceLike;
  let cursorRepository: jest.Mocked<ConnectionCursorRepositoryPort>;

  const baseResult: FulfillmentStatusSyncResult = {
    scanned: 1,
    created: 1,
    updated: 0,
    skipped: 0,
    failed: 0,
    total: 50,
    nextOffset: 10,
  };

  beforeEach(() => {
    fulfillmentStatusSync = { sync: jest.fn().mockResolvedValue(baseResult) };
    cursorRepository = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ConnectionCursorRepositoryPort>;

    handler = new MarketplaceFulfillmentStatusSyncHandler(
      fulfillmentStatusSync as never,
      cursorRepository,
    );
  });

  const createJob = (payload: Record<string, unknown>): SyncJob => ({
    id: 'job-id',
    jobType: 'marketplace.fulfillment.statusSync' as unknown as SyncJob['jobType'],
    connectionId: 'connection-1',
    payload,
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

  it('starts at offset 0 with the default cursor key when no cursor is stored', async () => {
    const job = createJob({ schemaVersion: 1, limit: 25 });

    const result = await handler.execute(job);

    expect(cursorRepository.get).toHaveBeenCalledWith(
      'connection-1',
      'prestashop.fulfillmentStatus.scanOffset',
    );
    expect(fulfillmentStatusSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 25,
      offset: 0,
      updatedSinceDays: undefined,
    });
    expect(cursorRepository.set).toHaveBeenCalledWith(
      'connection-1',
      'prestashop.fulfillmentStatus.scanOffset',
      '10',
    );
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('honours the payload cursorKey + updatedSinceDays + limit', async () => {
    const job = createJob({
      schemaVersion: 1,
      limit: 50,
      cursorKey: 'custom.cursor.key',
      updatedSinceDays: 45,
    });

    await handler.execute(job);

    expect(cursorRepository.get).toHaveBeenCalledWith('connection-1', 'custom.cursor.key');
    expect(fulfillmentStatusSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 50,
      offset: 0,
      updatedSinceDays: 45,
    });
    expect(cursorRepository.set).toHaveBeenCalledWith(
      'connection-1',
      'custom.cursor.key',
      '10',
    );
  });

  it('parses the stored offset string into a number', async () => {
    cursorRepository.get.mockResolvedValue('42');
    const job = createJob({ schemaVersion: 1, limit: 10 });

    await handler.execute(job);

    expect(fulfillmentStatusSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 10,
      offset: 42,
      updatedSinceDays: undefined,
    });
  });

  it('falls back to default limit when payload limit is missing/invalid', async () => {
    const job = createJob({ schemaVersion: 1, limit: 'bogus' as unknown as number });

    await handler.execute(job);

    expect(fulfillmentStatusSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 100,
      offset: 0,
      updatedSinceDays: undefined,
    });
  });

  it('wraps service errors in SyncJobExecutionError', async () => {
    fulfillmentStatusSync.sync.mockRejectedValue(new Error('downstream'));
    const job = createJob({ schemaVersion: 1, limit: 10 });

    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('throws when the payload is missing', async () => {
    const job = createJob(null as unknown as Record<string, unknown>);

    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
