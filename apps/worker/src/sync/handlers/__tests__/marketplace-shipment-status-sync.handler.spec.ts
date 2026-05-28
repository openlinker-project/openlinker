/**
 * Marketplace Shipment Status Sync Handler Tests (#838)
 *
 * Mirrors `marketplace-offer-status-sync.handler.spec.ts` (#816): scan-offset
 * cursor read/parse/advance, default cursor key + limit, ok outcome, and error
 * wrapping. Doesn't re-cover the workaround logic — that's tested on the core
 * service.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { ConnectionCursorRepositoryPort } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import type { ShipmentStatusSyncResult } from '@openlinker/core/shipping';

import { MarketplaceShipmentStatusSyncHandler } from '../marketplace-shipment-status-sync.handler';

describe('MarketplaceShipmentStatusSyncHandler', () => {
  let handler: MarketplaceShipmentStatusSyncHandler;
  type ShipmentStatusSyncServiceLike = { sync: jest.Mock };
  let shipmentStatusSync: ShipmentStatusSyncServiceLike;
  let cursorRepository: jest.Mocked<ConnectionCursorRepositoryPort>;

  const baseResult: ShipmentStatusSyncResult = {
    scanned: 1,
    updated: 1,
    propagated: 0,
    failed: 0,
    total: 50,
    nextOffset: 10,
  };

  beforeEach(() => {
    shipmentStatusSync = { sync: jest.fn().mockResolvedValue(baseResult) };
    cursorRepository = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ConnectionCursorRepositoryPort>;

    handler = new MarketplaceShipmentStatusSyncHandler(
      shipmentStatusSync as never,
      cursorRepository,
    );
  });

  const createJob = (payload: Record<string, unknown>): SyncJob => ({
    id: 'job-id',
    jobType: 'marketplace.shipment.statusSync' as unknown as SyncJob['jobType'],
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
      'allegro.shipmentStatus.scanOffset',
    );
    expect(shipmentStatusSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 25,
      offset: 0,
    });
    expect(cursorRepository.set).toHaveBeenCalledWith(
      'connection-1',
      'allegro.shipmentStatus.scanOffset',
      '10',
    );
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('parses the stored numeric offset and passes it to the service', async () => {
    const job = createJob({
      schemaVersion: 1,
      limit: 25,
      cursorKey: 'allegro.shipmentStatus.scanOffset',
    });
    cursorRepository.get.mockResolvedValue('30');

    await handler.execute(job);

    expect(shipmentStatusSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 25,
      offset: 30,
    });
  });

  it('honours a custom cursor key from the payload', async () => {
    const job = createJob({ schemaVersion: 1, limit: 10, cursorKey: 'custom.cursor' });

    await handler.execute(job);

    expect(cursorRepository.get).toHaveBeenCalledWith('connection-1', 'custom.cursor');
    expect(cursorRepository.set).toHaveBeenCalledWith('connection-1', 'custom.cursor', '10');
  });

  it('defaults limit to 50 when the payload limit is missing or invalid', async () => {
    const job = createJob({ schemaVersion: 1 });

    await handler.execute(job);

    expect(shipmentStatusSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 50,
      offset: 0,
    });
  });

  it('treats a non-numeric stored cursor as offset 0', async () => {
    const job = createJob({ schemaVersion: 1, limit: 10 });
    cursorRepository.get.mockResolvedValue('not-a-number');

    await handler.execute(job);

    expect(shipmentStatusSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 10,
      offset: 0,
    });
  });

  it('throws SyncJobExecutionError when the payload is not an object', async () => {
    const job = createJob(null as unknown as Record<string, unknown>);

    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('wraps service failures in SyncJobExecutionError without advancing the cursor', async () => {
    const job = createJob({ schemaVersion: 1, limit: 10 });
    shipmentStatusSync.sync.mockRejectedValue(new Error('boom'));

    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(cursorRepository.set).not.toHaveBeenCalled();
  });
});
