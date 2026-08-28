/**
 * Orders Tax Rate Backfill Handler Tests
 *
 * Unit tests for OrdersTaxRateBackfillHandler (#2440): id-based cursor
 * read/advance/clear, default cursor key + limit, ok outcome, and error
 * wrapping.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { OrdersTaxRateBackfillHandler } from '../orders-tax-rate-backfill.handler';
import type { ConnectionCursorRepositoryPort } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import type { TaxRateBackfillPageResult } from '@openlinker/core/orders';

describe('OrdersTaxRateBackfillHandler', () => {
  let handler: OrdersTaxRateBackfillHandler;
  let syncLock: { acquire: jest.Mock; release: jest.Mock; extend: jest.Mock };
  type TaxRateBackfillServiceLike = { backfillPage: jest.Mock };
  let taxRateBackfill: TaxRateBackfillServiceLike;
  let cursorRepository: jest.Mocked<ConnectionCursorRepositoryPort>;

  const baseResult: TaxRateBackfillPageResult = {
    scanned: 1,
    updated: 1,
    nextCursor: 'line-10',
  };

  beforeEach(() => {
    taxRateBackfill = { backfillPage: jest.fn().mockResolvedValue(baseResult) };
    cursorRepository = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ConnectionCursorRepositoryPort>;

    // Uncontended lock and default TTL (#2594 review).
    syncLock = {
      acquire: jest.fn().mockResolvedValue('lock-token'),
      release: jest.fn().mockResolvedValue(true),
      extend: jest.fn().mockResolvedValue(true),
    };

    handler = new OrdersTaxRateBackfillHandler(
      taxRateBackfill as never,
      cursorRepository,
      syncLock as never,
      { get: jest.fn().mockReturnValue(undefined) } as never
    );
  });

  const createJob = (payload: Record<string, unknown>): SyncJob => ({
    id: 'job-id',
    jobType: 'orders.taxRate.backfill' as unknown as SyncJob['jobType'],
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

  it('starts with afterId null and the default cursor key when no cursor is stored', async () => {
    const job = createJob({ schemaVersion: 1, limit: 25 });

    const result = await handler.execute(job);

    expect(cursorRepository.get).toHaveBeenCalledWith(
      'connection-1',
      'orders.taxRate.backfill.afterId'
    );
    expect(taxRateBackfill.backfillPage).toHaveBeenCalledWith({
      sourceConnectionId: 'connection-1',
      limit: 25,
      afterId: null,
    });
    expect(cursorRepository.set).toHaveBeenCalledWith(
      'connection-1',
      'orders.taxRate.backfill.afterId',
      'line-10'
    );
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('passes the stored afterId cursor to the service', async () => {
    const job = createJob({ schemaVersion: 1, limit: 25 });
    cursorRepository.get.mockResolvedValue('line-5');

    await handler.execute(job);

    expect(taxRateBackfill.backfillPage).toHaveBeenCalledWith({
      sourceConnectionId: 'connection-1',
      limit: 25,
      afterId: 'line-5',
    });
  });

  it('honours a custom cursor key from the payload', async () => {
    const job = createJob({ schemaVersion: 1, limit: 10, cursorKey: 'custom.cursor' });

    await handler.execute(job);

    expect(cursorRepository.get).toHaveBeenCalledWith('connection-1', 'custom.cursor');
    expect(cursorRepository.set).toHaveBeenCalledWith('connection-1', 'custom.cursor', 'line-10');
  });

  it('defaults limit to 100 when the payload limit is missing or invalid', async () => {
    const job = createJob({ schemaVersion: 1 });

    await handler.execute(job);

    expect(taxRateBackfill.backfillPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 })
    );
  });

  it('deletes the cursor (never sets an empty string) when the frontier is exhausted', async () => {
    const job = createJob({ schemaVersion: 1, limit: 10 });
    taxRateBackfill.backfillPage.mockResolvedValue({ scanned: 1, updated: 0, nextCursor: null });

    await handler.execute(job);

    expect(cursorRepository.delete).toHaveBeenCalledWith(
      'connection-1',
      'orders.taxRate.backfill.afterId'
    );
    expect(cursorRepository.set).not.toHaveBeenCalled();
  });

  it('throws SyncJobExecutionError when the payload is not an object', async () => {
    const job = createJob(null as unknown as Record<string, unknown>);

    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('wraps service failures in SyncJobExecutionError', async () => {
    const job = createJob({ schemaVersion: 1, limit: 10 });
    taxRateBackfill.backfillPage.mockRejectedValue(new Error('boom'));

    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(cursorRepository.set).not.toHaveBeenCalled();
    expect(cursorRepository.delete).not.toHaveBeenCalled();
  });
});
