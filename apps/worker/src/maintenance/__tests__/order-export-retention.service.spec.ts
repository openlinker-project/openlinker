/**
 * Order Export Retention Service Unit Tests (#3534 recovery pass)
 *
 * Pins: the lease is acquired and always released, a run that fails to
 * acquire the lease is a no-op skip (never an error), batching continues
 * while a batch comes back full and stops on the first short batch, the
 * per-run batch budget is respected, and a thrown error never escapes
 * `runOnce()` — the `SyncJobRetentionService` (#2946) precedent, simplified
 * for a fixed-TTL sweep with no Operational Settings read.
 *
 * @module apps/worker/src/maintenance
 */
import type { ConfigService } from '@nestjs/config';
import type { IOrderExportService } from '@openlinker/core/orders';
import type { SyncLockPort } from '@openlinker/core/sync';
import {
  MAX_BATCHES_PER_RUN,
  PURGE_BATCH_SIZE,
  OrderExportRetentionService,
} from '../order-export-retention.service';

describe('OrderExportRetentionService', () => {
  let exportService: jest.Mocked<IOrderExportService>;
  let syncLock: jest.Mocked<SyncLockPort>;
  let service: OrderExportRetentionService;

  const makeConfig = (overrides: Record<string, string> = {}): ConfigService =>
    ({
      get: jest.fn((key: string, defaultValue?: string) => overrides[key] ?? defaultValue),
    }) as unknown as ConfigService;

  const build = (overrides: Record<string, string> = {}): OrderExportRetentionService =>
    new OrderExportRetentionService(exportService, syncLock, makeConfig(overrides));

  beforeEach(() => {
    exportService = {
      requestExport: jest.fn(),
      getRun: jest.fn(),
      markReady: jest.fn(),
      markFailed: jest.fn(),
      purgeExpiredFiles: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<IOrderExportService>;
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
    it('skips the run without touching order_exports when the lease is not acquired', async () => {
      syncLock.acquire.mockResolvedValue(null);

      const result = await service.runOnce();

      expect(result).toBeNull();
      expect(exportService.purgeExpiredFiles).not.toHaveBeenCalled();
      expect(syncLock.release).not.toHaveBeenCalled();
    });

    it('always releases the lease it acquired, even when the pass throws', async () => {
      exportService.purgeExpiredFiles.mockRejectedValue(new Error('db down'));

      await expect(service.runOnce()).resolves.toBeNull();

      expect(syncLock.release).toHaveBeenCalledWith(
        'maintenance:order-export-retention:sweep',
        'token-1',
      );
    });

    it('purges against `now`, not a configurable cutoff — the run\'s own expiresAt decides eligibility', async () => {
      const before = Date.now();
      await service.runOnce();
      const after = Date.now();

      expect(exportService.purgeExpiredFiles).toHaveBeenCalledWith(expect.any(Date), PURGE_BATCH_SIZE);
      const passedNow = exportService.purgeExpiredFiles.mock.calls[0][0].getTime();
      expect(passedNow).toBeGreaterThanOrEqual(before);
      expect(passedNow).toBeLessThanOrEqual(after);
    });

    it('keeps batching while a batch comes back full, and stops on the first short batch', async () => {
      exportService.purgeExpiredFiles.mockImplementation(() => {
        const callsSoFar = exportService.purgeExpiredFiles.mock.calls.length;
        return Promise.resolve(callsSoFar <= 3 ? PURGE_BATCH_SIZE : 42);
      });

      const result = await service.runOnce();

      expect(exportService.purgeExpiredFiles).toHaveBeenCalledTimes(4);
      expect(result?.cleared).toBe(3 * PURGE_BATCH_SIZE + 42);
      expect(result?.budgetExhausted).toBe(false);
    });

    it('reports budgetExhausted and stops after MAX_BATCHES_PER_RUN full batches', async () => {
      exportService.purgeExpiredFiles.mockResolvedValue(PURGE_BATCH_SIZE);

      const result = await service.runOnce();

      expect(exportService.purgeExpiredFiles).toHaveBeenCalledTimes(MAX_BATCHES_PER_RUN);
      expect(result?.cleared).toBe(MAX_BATCHES_PER_RUN * PURGE_BATCH_SIZE);
      expect(result?.budgetExhausted).toBe(true);
    });

    it('reports zero cleared, no budget exhaustion, when nothing is eligible', async () => {
      exportService.purgeExpiredFiles.mockResolvedValue(0);

      const result = await service.runOnce();

      expect(exportService.purgeExpiredFiles).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ cleared: 0, budgetExhausted: false });
    });
  });

  describe('onModuleInit', () => {
    it('does not start the sweep when WORKER_MAINTENANCE_ENABLED=false', () => {
      const disabled = build({ WORKER_MAINTENANCE_ENABLED: 'false' });
      const startSpy = jest.spyOn(disabled, 'start');

      disabled.onModuleInit();

      expect(startSpy).not.toHaveBeenCalled();
      disabled.stop();
    });

    it('starts the sweep by default', () => {
      const startSpy = jest.spyOn(service, 'start');

      service.onModuleInit();

      expect(startSpy).toHaveBeenCalled();
    });
  });

  describe('start/stop', () => {
    it('is idempotent — calling start twice does not create a second interval', () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      service.start(1000);
      service.start(1000);

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    });
  });
});
