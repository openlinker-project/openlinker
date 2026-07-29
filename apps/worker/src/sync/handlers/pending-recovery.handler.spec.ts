/**
 * Unit tests for `PendingRecoveryHandler` (#1703).
 *
 * Mocks `IPendingRecoveryService`. Pins payload validation, the `limit` clamp
 * to MAX_LIMIT, the ok outcome, and OL-shaped error wrapping.
 *
 * @module apps/worker/src/sync/handlers
 */
import type { IPendingRecoveryService } from '@openlinker/core/invoicing';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import { PendingRecoveryHandler } from './pending-recovery.handler';

function makeJob(payload: unknown): SyncJob {
  return {
    id: 'job-1',
    jobType: 'invoicing.pendingRecovery.sweep',
    connectionId: 'conn-1',
    payload,
    idempotencyKey: 'invoicing:conn-1:pendingRecovery:sweep:2026-07-16-03-00',
    status: 'running',
    attempts: 1,
    maxAttempts: 10,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SyncJob;
}

const ZEROED = { scanned: 0, recovered: 0, markedInDoubt: 0, errors: 0, total: 0 };

describe('PendingRecoveryHandler', () => {
  let pendingRecoveryService: jest.Mocked<IPendingRecoveryService>;
  let handler: PendingRecoveryHandler;

  beforeEach(() => {
    pendingRecoveryService = {
      recover: jest.fn().mockResolvedValue(ZEROED),
    };
    handler = new PendingRecoveryHandler(pendingRecoveryService);
  });

  describe('getPayload', () => {
    it('throws an OL-shaped SyncJobExecutionError when the payload is missing/invalid', async () => {
      await expect(handler.execute(makeJob(undefined))).rejects.toBeInstanceOf(
        SyncJobExecutionError,
      );
      await expect(handler.execute(makeJob({ schemaVersion: 2 }))).rejects.toBeInstanceOf(
        SyncJobExecutionError,
      );
      expect(pendingRecoveryService.recover).not.toHaveBeenCalled();
    });

    it('defaults limit to DEFAULT_LIMIT when payload.limit is absent or not a positive number', async () => {
      await handler.execute(makeJob({ schemaVersion: 1 }));
      expect(pendingRecoveryService.recover).toHaveBeenLastCalledWith('conn-1', { limit: 100 });

      await handler.execute(makeJob({ schemaVersion: 1, limit: -5 }));
      expect(pendingRecoveryService.recover).toHaveBeenLastCalledWith('conn-1', { limit: 100 });
    });

    it('clamps an out-of-range payload.limit down to MAX_LIMIT', async () => {
      await handler.execute(makeJob({ schemaVersion: 1, limit: 100000 }));
      expect(pendingRecoveryService.recover).toHaveBeenCalledWith('conn-1', { limit: 500 });
    });

    it('passes through a valid in-range limit unchanged', async () => {
      await handler.execute(makeJob({ schemaVersion: 1, limit: 250 }));
      expect(pendingRecoveryService.recover).toHaveBeenCalledWith('conn-1', { limit: 250 });
    });
  });

  describe('execute', () => {
    it('delegates to pendingRecoveryService.recover(connectionId, { limit }) and returns { outcome: "ok" }', async () => {
      const result = await handler.execute(makeJob({ schemaVersion: 1, limit: 50 }));

      expect(pendingRecoveryService.recover).toHaveBeenCalledWith('conn-1', { limit: 50 });
      expect(result).toEqual({ outcome: 'ok' });
    });

    it('wraps a thrown error in an OL-shaped SyncJobExecutionError carrying job id / type / connectionId', async () => {
      pendingRecoveryService.recover.mockRejectedValue(new Error('repo down'));

      await expect(handler.execute(makeJob({ schemaVersion: 1, limit: 50 }))).rejects.toMatchObject({
        name: 'SyncJobExecutionError',
        jobId: 'job-1',
        jobType: 'invoicing.pendingRecovery.sweep',
        connectionId: 'conn-1',
      });
    });
  });
});
