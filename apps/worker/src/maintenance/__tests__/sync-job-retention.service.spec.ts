/**
 * Sync Job Retention Service Unit Tests (#2946)
 *
 * Pins: the lease is acquired and always released, a run that fails to
 * acquire the lease is a no-op skip (never an error), both retention windows
 * are read from Operational Settings and used as the cutoff for their OWN
 * status, batching continues while a batch comes back full and stops on the
 * first short batch, the per-run batch budget is respected, and a thrown
 * error never escapes `runOnce()`.
 *
 * @module apps/worker/src/maintenance
 */
import type { ConfigService } from '@nestjs/config';
import type {
  IOperationalSettingsService,
  OperationalSettingsView,
} from '@openlinker/core/operational-settings';
import type { ISyncJobsService, SyncLockPort } from '@openlinker/core/sync';
import {
  MAX_BATCHES_PER_RUN,
  PRUNE_BATCH_SIZE,
  SyncJobRetentionService,
} from '../sync-job-retention.service';

function makeSettingsView(
  overrides: Partial<{ retentionDays: number; deadRetentionDays: number }> = {}
): OperationalSettingsView {
  const numberField = (value: number) => ({
    value,
    source: 'default' as const,
    workerMayDiffer: true,
    recommendedMax: 365,
    recommendedReason: '',
    absoluteMax: 365,
    absoluteReason: '',
    aboveRecommended: false,
  });
  return {
    catalogueSweepBudget: numberField(500),
    inventorySweepBudget: numberField(100),
    sweepPageSize: numberField(100),
    deletionAuditBudget: numberField(100),
    syncJobRetentionDays: numberField(overrides.retentionDays ?? 30),
    syncJobDeadRetentionDays: numberField(overrides.deadRetentionDays ?? 90),
    deletionAuditCadence: { value: '0 * * * *', source: 'default', workerMayDiffer: true },
    catalogueSweepCadence: { value: '*/20 * * * *', source: 'default', workerMayDiffer: true },
    inventorySweepCadence: { value: '*/15 * * * *', source: 'default', workerMayDiffer: true },
    deletionAuditAlwaysEnabled: true,
    updatedAt: null,
    updatedBy: null,
  };
}

describe('SyncJobRetentionService', () => {
  let syncJobsService: jest.Mocked<ISyncJobsService>;
  let operationalSettingsService: jest.Mocked<IOperationalSettingsService>;
  let syncLock: jest.Mocked<SyncLockPort>;
  let service: SyncJobRetentionService;

  const makeConfig = (overrides: Record<string, string> = {}): ConfigService =>
    ({
      get: jest.fn((key: string, defaultValue?: string) => overrides[key] ?? defaultValue),
    }) as unknown as ConfigService;

  const build = (overrides: Record<string, string> = {}): SyncJobRetentionService =>
    new SyncJobRetentionService(
      syncJobsService,
      operationalSettingsService,
      syncLock,
      makeConfig(overrides)
    );

  beforeEach(() => {
    syncJobsService = {
      pruneTerminalJobs: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<ISyncJobsService>;
    operationalSettingsService = {
      resolve: jest.fn().mockResolvedValue(makeSettingsView()),
    } as unknown as jest.Mocked<IOperationalSettingsService>;
    syncLock = {
      acquire: jest.fn().mockResolvedValue('token-1'),
      release: jest.fn().mockResolvedValue(true),
      extend: jest.fn().mockResolvedValue(true),
    };
    service = build();
  });

  afterEach(() => {
    service.stop();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('runOnce', () => {
    it('skips the run without touching sync_jobs when the lease is not acquired', async () => {
      syncLock.acquire.mockResolvedValue(null);

      const result = await service.runOnce();

      expect(result).toBeNull();
      expect(operationalSettingsService.resolve).not.toHaveBeenCalled();
      expect(syncJobsService.pruneTerminalJobs).not.toHaveBeenCalled();
      expect(syncLock.release).not.toHaveBeenCalled();
    });

    it('always releases the lease it acquired, even when the pass throws', async () => {
      operationalSettingsService.resolve.mockRejectedValue(new Error('db down'));

      await expect(service.runOnce()).resolves.toBeNull();

      expect(syncLock.release).toHaveBeenCalledWith('maintenance:sync-job-retention:sweep', 'token-1');
    });

    it('prunes succeeded and dead jobs against their OWN resolved cutoff', async () => {
      operationalSettingsService.resolve.mockResolvedValue(
        makeSettingsView({ retentionDays: 30, deadRetentionDays: 90 })
      );
      syncJobsService.pruneTerminalJobs.mockResolvedValue(0);

      const before = Date.now();
      await service.runOnce();
      const after = Date.now();

      const calls = syncJobsService.pruneTerminalJobs.mock.calls;
      const succeededCall = calls.find((c) => c[0] === 'succeeded');
      const deadCall = calls.find((c) => c[0] === 'dead');
      expect(succeededCall).toBeDefined();
      expect(deadCall).toBeDefined();

      const succeededCutoff = (succeededCall as [string, Date, number])[1].getTime();
      const deadCutoff = (deadCall as [string, Date, number])[1].getTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

      expect(succeededCutoff).toBeGreaterThanOrEqual(before - thirtyDaysMs - 1000);
      expect(succeededCutoff).toBeLessThanOrEqual(after - thirtyDaysMs + 1000);
      expect(deadCutoff).toBeGreaterThanOrEqual(before - ninetyDaysMs - 1000);
      expect(deadCutoff).toBeLessThanOrEqual(after - ninetyDaysMs + 1000);
      expect(deadCutoff).toBeLessThan(succeededCutoff); // dead is retained LONGER, so its cutoff is further back
    });

    it('keeps batching while a batch comes back full, and stops on the first short batch', async () => {
      syncJobsService.pruneTerminalJobs.mockImplementation((status: 'succeeded' | 'dead') => {
        if (status === 'succeeded') {
          // Three full batches then a short one.
          const callsSoFar = syncJobsService.pruneTerminalJobs.mock.calls.filter(
            (c) => c[0] === 'succeeded'
          ).length;
          return Promise.resolve(callsSoFar <= 3 ? PRUNE_BATCH_SIZE : 42);
        }
        return Promise.resolve(0);
      });

      const result = await service.runOnce();

      const succeededBatches = syncJobsService.pruneTerminalJobs.mock.calls.filter(
        (c) => c[0] === 'succeeded'
      );
      expect(succeededBatches).toHaveLength(4);
      expect(result?.succeededDeleted).toBe(3 * PRUNE_BATCH_SIZE + 42);
      expect(result?.succeededBudgetExhausted).toBe(false);
    });

    it('reports budgetExhausted and stops after MAX_BATCHES_PER_RUN full batches', async () => {
      syncJobsService.pruneTerminalJobs.mockImplementation((status: 'succeeded' | 'dead') =>
        Promise.resolve(status === 'dead' ? PRUNE_BATCH_SIZE : 0)
      );

      const result = await service.runOnce();

      const deadBatches = syncJobsService.pruneTerminalJobs.mock.calls.filter(
        (c) => c[0] === 'dead'
      );
      expect(deadBatches).toHaveLength(MAX_BATCHES_PER_RUN);
      expect(result?.deadDeleted).toBe(MAX_BATCHES_PER_RUN * PRUNE_BATCH_SIZE);
      expect(result?.deadBudgetExhausted).toBe(true);
    });

    it('never touches queued or running rows — only succeeded/dead are ever requested', async () => {
      await service.runOnce();

      const requestedStatuses = new Set(
        syncJobsService.pruneTerminalJobs.mock.calls.map((c) => c[0])
      );
      expect(requestedStatuses).toEqual(new Set(['succeeded', 'dead']));
    });
  });

  describe('enable gate', () => {
    it('does not start the loop when WORKER_MAINTENANCE_ENABLED=false', () => {
      jest.useFakeTimers();
      const disabled = build({ WORKER_MAINTENANCE_ENABLED: 'false' });
      disabled.onModuleInit();

      jest.advanceTimersByTime(2 * 60 * 60 * 1000);

      expect(syncLock.acquire).not.toHaveBeenCalled();
      disabled.stop();
    });
  });
});
