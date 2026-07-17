/**
 * Unit tests for `OfflineResubmitHandler` (#1702).
 *
 * Mocks `IOfflineResubmissionService`. Pins payload validation, the `limit` clamp
 * to MAX_LIMIT, the ok outcome, and OL-shaped error wrapping.
 *
 * @module apps/worker/src/sync/handlers
 */
import type { ConfigService } from '@nestjs/config';
import type { IOfflineResubmissionService } from '@openlinker/core/invoicing';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import { OfflineResubmitHandler } from './offline-resubmit.handler';

function makeJob(payload: unknown): SyncJob {
  return {
    id: 'job-1',
    jobType: 'invoicing.offlineSubmission.resubmit',
    connectionId: 'conn-1',
    payload,
    idempotencyKey: 'invoicing:conn-1:offlineSubmission:resubmit:2026-07-16-03-00',
    status: 'running',
    attempts: 1,
    maxAttempts: 10,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SyncJob;
}

const ZEROED = { scanned: 0, updated: 0, resubmitErrors: 0, total: 0 };

describe('OfflineResubmitHandler', () => {
  let offlineResubmissionService: jest.Mocked<IOfflineResubmissionService>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;
  let handler: OfflineResubmitHandler;

  beforeEach(() => {
    offlineResubmissionService = {
      resubmit: jest.fn().mockResolvedValue(ZEROED),
    };
    configService = { get: jest.fn().mockReturnValue(undefined) };
    handler = new OfflineResubmitHandler(
      offlineResubmissionService,
      configService as unknown as ConfigService,
    );
  });

  describe('getPayload', () => {
    it('throws an OL-shaped SyncJobExecutionError when the payload is missing/invalid', async () => {
      await expect(handler.execute(makeJob(undefined))).rejects.toBeInstanceOf(
        SyncJobExecutionError,
      );
      await expect(handler.execute(makeJob({ schemaVersion: 2 }))).rejects.toBeInstanceOf(
        SyncJobExecutionError,
      );
      expect(offlineResubmissionService.resubmit).not.toHaveBeenCalled();
    });

    it('defaults limit to DEFAULT_LIMIT when payload.limit is absent or not a positive number', async () => {
      await handler.execute(makeJob({ schemaVersion: 1 }));
      expect(offlineResubmissionService.resubmit).toHaveBeenLastCalledWith('conn-1', { limit: 100 });

      await handler.execute(makeJob({ schemaVersion: 1, limit: -5 }));
      expect(offlineResubmissionService.resubmit).toHaveBeenLastCalledWith('conn-1', { limit: 100 });
    });

    it('clamps an out-of-range payload.limit down to MAX_LIMIT', async () => {
      await handler.execute(makeJob({ schemaVersion: 1, limit: 100000 }));
      expect(offlineResubmissionService.resubmit).toHaveBeenCalledWith('conn-1', { limit: 500 });
    });

    it('passes through a valid in-range limit unchanged', async () => {
      await handler.execute(makeJob({ schemaVersion: 1, limit: 250 }));
      expect(offlineResubmissionService.resubmit).toHaveBeenCalledWith('conn-1', { limit: 250 });
    });
  });

  describe('execute', () => {
    it('delegates to offlineResubmissionService.resubmit(connectionId, { limit }) and returns { outcome: "ok" }', async () => {
      const result = await handler.execute(makeJob({ schemaVersion: 1, limit: 50 }));

      expect(offlineResubmissionService.resubmit).toHaveBeenCalledWith('conn-1', { limit: 50 });
      expect(result).toEqual({ outcome: 'ok' });
    });

    it('passes a positive OL_OFFLINE_RESUBMIT_SETTLING_MARGIN_MS through as settlingMarginMs (#1585 F4)', async () => {
      configService.get.mockReturnValue('1800000');
      await handler.execute(makeJob({ schemaVersion: 1, limit: 50 }));
      expect(offlineResubmissionService.resubmit).toHaveBeenCalledWith('conn-1', {
        limit: 50,
        settlingMarginMs: 1_800_000,
      });
    });

    it('ignores a non-positive settling-margin env, leaving the service default (#1585 F4)', async () => {
      configService.get.mockReturnValue('0');
      await handler.execute(makeJob({ schemaVersion: 1, limit: 50 }));
      expect(offlineResubmissionService.resubmit).toHaveBeenCalledWith('conn-1', {
        limit: 50,
        settlingMarginMs: undefined,
      });
    });

    it('wraps a thrown error in an OL-shaped SyncJobExecutionError carrying job id / type / connectionId', async () => {
      offlineResubmissionService.resubmit.mockRejectedValue(new Error('repo down'));

      await expect(handler.execute(makeJob({ schemaVersion: 1, limit: 50 }))).rejects.toMatchObject({
        name: 'SyncJobExecutionError',
        jobId: 'job-1',
        jobType: 'invoicing.offlineSubmission.resubmit',
        connectionId: 'conn-1',
      });
    });
  });
});
