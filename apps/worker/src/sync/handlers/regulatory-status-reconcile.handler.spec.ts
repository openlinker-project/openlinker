/**
 * Unit tests for `RegulatoryStatusReconcileHandler` (#1121).
 *
 * Mocks `IRegulatoryStatusReconciliationService`. Pins payload validation, the
 * `limit` clamp to MAX_LIMIT (decision #13), the ok outcome, and OL-shaped error
 * wrapping. No cursor assertions (the cursor is dropped — decision #5).
 *
 * @module apps/worker/src/sync/handlers
 */
import type { IRegulatoryStatusReconciliationService } from '@openlinker/core/invoicing';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import { RegulatoryStatusReconcileHandler } from './regulatory-status-reconcile.handler';

function makeJob(payload: unknown): SyncJob {
  return {
    id: 'job-1',
    jobType: 'invoicing.regulatoryStatus.reconcile',
    connectionId: 'conn-1',
    payload,
    idempotencyKey: 'invoicing:conn-1:regulatoryStatus:reconcile:2026-06-05-03-00',
    status: 'running',
    attempts: 1,
    maxAttempts: 10,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SyncJob;
}

const ZEROED = { scanned: 0, updated: 0, skippedTerminal: 0, readErrors: 0, total: 0 };

describe('RegulatoryStatusReconcileHandler', () => {
  let reconciliationService: jest.Mocked<IRegulatoryStatusReconciliationService>;
  let handler: RegulatoryStatusReconcileHandler;

  beforeEach(() => {
    reconciliationService = {
      reconcile: jest.fn().mockResolvedValue(ZEROED),
    };
    handler = new RegulatoryStatusReconcileHandler(reconciliationService);
  });

  describe('getPayload', () => {
    it('throws an OL-shaped SyncJobExecutionError when the payload is missing/invalid', async () => {
      await expect(handler.execute(makeJob(undefined))).rejects.toBeInstanceOf(
        SyncJobExecutionError,
      );
      await expect(handler.execute(makeJob({ schemaVersion: 2 }))).rejects.toBeInstanceOf(
        SyncJobExecutionError,
      );
      expect(reconciliationService.reconcile).not.toHaveBeenCalled();
    });

    it('defaults limit to DEFAULT_LIMIT when payload.limit is absent or not a positive number', async () => {
      await handler.execute(makeJob({ schemaVersion: 1 }));
      expect(reconciliationService.reconcile).toHaveBeenLastCalledWith('conn-1', { limit: 100 });

      await handler.execute(makeJob({ schemaVersion: 1, limit: -5 }));
      expect(reconciliationService.reconcile).toHaveBeenLastCalledWith('conn-1', { limit: 100 });
    });

    it('clamps an out-of-range payload.limit down to MAX_LIMIT (decision #13)', async () => {
      await handler.execute(makeJob({ schemaVersion: 1, limit: 100000 }));
      expect(reconciliationService.reconcile).toHaveBeenCalledWith('conn-1', { limit: 500 });
    });

    it('passes through a valid in-range limit unchanged', async () => {
      await handler.execute(makeJob({ schemaVersion: 1, limit: 250 }));
      expect(reconciliationService.reconcile).toHaveBeenCalledWith('conn-1', { limit: 250 });
    });
  });

  describe('execute', () => {
    it('delegates to reconciliationService.reconcile(connectionId, { limit }) and returns { outcome: "ok" }', async () => {
      const result = await handler.execute(makeJob({ schemaVersion: 1, limit: 50 }));

      expect(reconciliationService.reconcile).toHaveBeenCalledWith('conn-1', { limit: 50 });
      expect(result).toEqual({ outcome: 'ok' });
    });

    it('wraps a thrown error in an OL-shaped SyncJobExecutionError carrying job id / type / connectionId', async () => {
      reconciliationService.reconcile.mockRejectedValue(new Error('repo down'));

      await expect(handler.execute(makeJob({ schemaVersion: 1, limit: 50 }))).rejects.toMatchObject({
        name: 'SyncJobExecutionError',
        jobId: 'job-1',
        jobType: 'invoicing.regulatoryStatus.reconcile',
        connectionId: 'conn-1',
      });
    });
  });
});
