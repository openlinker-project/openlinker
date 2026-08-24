/**
 * Stuck Job Recovery Service Unit Tests
 *
 * Relocated from `sync-job.runner.spec.ts`'s `startStuckJobRecovery` block
 * when the sweep was extracted for the `maintenance` worker role (#2279,
 * ADR-051). Same behaviour pinned: periodic requeue at the lock timeout, a
 * throwing repository never escapes the interval callback, the loop is
 * idempotent and `unref`'d, and the enable gate is honoured.
 *
 * @module apps/worker/src/maintenance
 */
import type { ConfigService } from '@nestjs/config';
import type { ISyncJobsService } from '@openlinker/core/sync';
import { StuckJobRecoveryService } from '../stuck-job-recovery.service';

describe('StuckJobRecoveryService', () => {
  let syncJobsService: jest.Mocked<ISyncJobsService>;
  let service: StuckJobRecoveryService;

  const makeConfig = (overrides: Record<string, string> = {}): ConfigService =>
    ({
      get: jest.fn((key: string, defaultValue?: string) => overrides[key] ?? defaultValue),
    }) as unknown as ConfigService;

  const build = (overrides: Record<string, string> = {}): StuckJobRecoveryService =>
    new StuckJobRecoveryService(syncJobsService, makeConfig(overrides));

  beforeEach(() => {
    syncJobsService = {
      requeueStuckJobs: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<ISyncJobsService>;
    service = build();
  });

  afterEach(() => {
    service.stop();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('runOnce', () => {
    it('requeues jobs stuck past the 15-minute lock timeout', async () => {
      await service.runOnce();

      expect(syncJobsService.requeueStuckJobs).toHaveBeenCalledWith(15);
    });

    it('swallows a repository failure so one bad pass never kills the loop', async () => {
      syncJobsService.requeueStuckJobs.mockRejectedValue(new Error('Database error'));

      await expect(service.runOnce()).resolves.toBeUndefined();
    });
  });

  describe('periodic loop', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    });

    const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

    it('sweeps on each interval tick', async () => {
      service.start(1000);

      jest.advanceTimersByTime(1000);
      await settle();
      expect(syncJobsService.requeueStuckJobs).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1000);
      await settle();
      expect(syncJobsService.requeueStuckJobs).toHaveBeenCalledTimes(2);
    });

    it('is idempotent: a second start does not stack a second interval', async () => {
      service.start(1000);
      service.start(1000);

      jest.advanceTimersByTime(1000);
      await settle();

      expect(syncJobsService.requeueStuckJobs).toHaveBeenCalledTimes(1);
    });

    it('stops sweeping after stop()', async () => {
      service.start(1000);
      service.stop();

      jest.advanceTimersByTime(5000);
      await settle();

      expect(syncJobsService.requeueStuckJobs).not.toHaveBeenCalled();
    });

    it('does not keep the process alive (timer is unref\'d)', () => {
      const unref = jest.spyOn(global, 'setInterval');
      service.start(1000);

      const timer = unref.mock.results[0].value as NodeJS.Timeout;
      expect(typeof timer.unref).toBe('function');
      unref.mockRestore();
    });
  });

  describe('enable gate', () => {
    it('starts the loop on init by default', () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });
      service.onModuleInit();

      jest.advanceTimersByTime(5 * 60 * 1000);

      expect(syncJobsService.requeueStuckJobs).toHaveBeenCalled();
    });

    it('does not start when WORKER_MAINTENANCE_ENABLED=false', () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });
      service = build({ WORKER_MAINTENANCE_ENABLED: 'false' });

      service.onModuleInit();
      jest.advanceTimersByTime(10 * 60 * 1000);

      expect(syncJobsService.requeueStuckJobs).not.toHaveBeenCalled();
    });
  });
});
