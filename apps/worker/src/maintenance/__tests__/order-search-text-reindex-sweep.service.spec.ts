/**
 * Order Search Text Reindex Sweep Unit Tests (#3507 G03-14)
 *
 * Pins the scheduling around the core pass: the lease is acquired and always
 * released, a missed lease skips the tick, a budget-exhausted pass carries its
 * cursor into a scheduled follow-up, a finished pass resets the cursor, a
 * thrown error never escapes `runOnce()`, and the first pass runs shortly
 * after start rather than a day later.
 *
 * @module apps/worker/src/maintenance
 */
import type { ConfigService } from '@nestjs/config';
import type {
  IOrderSearchTextReindexService,
  OrderSearchTextReindexRunResult,
} from '@openlinker/core/orders';
import type { SyncLockPort } from '@openlinker/core/sync';
import { OrderSearchTextReindexSweepService } from '../order-search-text-reindex-sweep.service';

const DONE: OrderSearchTextReindexRunResult = {
  status: 'completed',
  scanned: 3,
  rewritten: 1,
  budgetExhausted: false,
  nextCursor: null,
};

describe('OrderSearchTextReindexSweepService', () => {
  let reindexService: jest.Mocked<IOrderSearchTextReindexService>;
  let syncLock: jest.Mocked<SyncLockPort>;
  let service: OrderSearchTextReindexSweepService;

  const makeConfig = (overrides: Record<string, string> = {}): ConfigService =>
    ({
      get: jest.fn((key: string, defaultValue?: string) => overrides[key] ?? defaultValue),
    }) as unknown as ConfigService;

  const build = (overrides: Record<string, string> = {}): OrderSearchTextReindexSweepService =>
    new OrderSearchTextReindexSweepService(reindexService, syncLock, makeConfig(overrides));

  beforeEach(() => {
    reindexService = { runOnce: jest.fn().mockResolvedValue(DONE) };
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
    it('should skip the pass without calling the reindex when the lease is not acquired', async () => {
      syncLock.acquire.mockResolvedValue(null);

      await expect(service.runOnce()).resolves.toBeNull();

      expect(reindexService.runOnce).not.toHaveBeenCalled();
      expect(syncLock.release).not.toHaveBeenCalled();
    });

    it('should release the lease and resolve null when the pass throws', async () => {
      reindexService.runOnce.mockRejectedValue(new Error('db down'));

      await expect(service.runOnce()).resolves.toBeNull();

      expect(syncLock.release).toHaveBeenCalledWith(
        'maintenance:order-search-text-reindex:sweep',
        'token-1'
      );
    });

    it('should start from the beginning of the table when no earlier pass left a cursor', async () => {
      await service.runOnce();

      expect(reindexService.runOnce).toHaveBeenCalledWith(null);
    });

    it('should resume from the cursor a budget-exhausted pass returned, then reset it once finished', async () => {
      reindexService.runOnce
        .mockResolvedValueOnce({ ...DONE, budgetExhausted: true, nextCursor: 'ol_order_m' })
        .mockResolvedValueOnce(DONE)
        .mockResolvedValueOnce(DONE);

      await service.runOnce();
      await service.runOnce();
      await service.runOnce();

      expect(reindexService.runOnce.mock.calls).toEqual([[null], ['ol_order_m'], [null]]);
    });
  });

  describe('scheduling', () => {
    it('should run the first pass shortly after start rather than a full interval later', async () => {
      jest.useFakeTimers();

      service.start(24 * 60 * 60 * 1000, 30_000);
      expect(reindexService.runOnce).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(30_000);

      expect(reindexService.runOnce).toHaveBeenCalledTimes(1);
    });

    it('should schedule a follow-up pass when a running sweep exhausts its budget', async () => {
      jest.useFakeTimers();
      reindexService.runOnce
        .mockResolvedValueOnce({ ...DONE, budgetExhausted: true, nextCursor: 'ol_order_m' })
        .mockResolvedValue(DONE);

      service.start(24 * 60 * 60 * 1000, 1_000);
      await jest.advanceTimersByTimeAsync(1_000);
      await jest.advanceTimersByTimeAsync(60_000);

      expect(reindexService.runOnce.mock.calls).toEqual([[null], ['ol_order_m']]);
    });

    it('should not start the sweep when WORKER_MAINTENANCE_ENABLED=false', () => {
      const disabled = build({ WORKER_MAINTENANCE_ENABLED: 'false' });
      const startSpy = jest.spyOn(disabled, 'start');

      disabled.onModuleInit();

      expect(startSpy).not.toHaveBeenCalled();
      disabled.stop();
    });

    it('should not create a second interval when start is called twice', () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      service.start(1000, 1000);
      service.start(1000, 1000);

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    });
  });
});
