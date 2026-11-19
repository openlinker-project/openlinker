/**
 * Order Buyer Data Retention Sweep Unit Tests (#4178)
 *
 * Pins the scheduling around the core pass: the lease is acquired and always
 * released, a missed lease skips the tick, a thrown error never escapes
 * `runOnce()`, the maintenance switch turns it off, and the first pass runs
 * shortly after start.
 *
 * @module apps/worker/src/maintenance
 */
import type { ConfigService } from '@nestjs/config';
import type {
  IOrderBuyerDataRetentionService,
  OrderBuyerDataRetentionRunResult,
} from '@openlinker/core/orders';
import type { SyncLockPort } from '@openlinker/core/sync';
import { OrderBuyerDataRetentionSweepService } from '../order-buyer-data-retention-sweep.service';

const DONE: OrderBuyerDataRetentionRunResult = {
  connections: [
    { sourceConnectionId: 'amz', retentionDays: 30, redacted: 2, customersRedacted: 0, budgetExhausted: false },
  ],
  redacted: 2,
};

describe('OrderBuyerDataRetentionSweepService', () => {
  let retention: jest.Mocked<IOrderBuyerDataRetentionService>;
  let syncLock: jest.Mocked<SyncLockPort>;
  let service: OrderBuyerDataRetentionSweepService;

  const makeConfig = (overrides: Record<string, string> = {}): ConfigService =>
    ({
      get: jest.fn((key: string, defaultValue?: string) => overrides[key] ?? defaultValue),
    }) as unknown as ConfigService;

  const build = (overrides: Record<string, string> = {}): OrderBuyerDataRetentionSweepService =>
    new OrderBuyerDataRetentionSweepService(retention, syncLock, makeConfig(overrides));

  beforeEach(() => {
    retention = { runOnce: jest.fn().mockResolvedValue(DONE) };
    syncLock = {
      acquire: jest.fn().mockResolvedValue('token-1'),
      release: jest.fn().mockResolvedValue(true),
      extend: jest.fn().mockResolvedValue(true),
    };
    service = build();
  });

  afterEach(() => {
    service.stop();
    jest.useRealTimers();
  });

  it('should run the pass under the lease and release it', async () => {
    await expect(service.runOnce()).resolves.toBe(DONE);
    expect(syncLock.acquire).toHaveBeenCalledWith('maintenance:order-buyer-data-retention:sweep', expect.any(Number));
    expect(syncLock.release).toHaveBeenCalledWith('maintenance:order-buyer-data-retention:sweep', 'token-1');
  });

  it('should skip the tick when another replica holds the lease', async () => {
    syncLock.acquire.mockResolvedValue(null);
    await expect(service.runOnce()).resolves.toBeNull();
    expect(retention.runOnce).not.toHaveBeenCalled();
  });

  it('should swallow a failed pass and still release the lease', async () => {
    retention.runOnce.mockRejectedValue(new Error('db down'));
    await expect(service.runOnce()).resolves.toBeNull();
    expect(syncLock.release).toHaveBeenCalled();
  });

  it('should not start when maintenance is switched off', () => {
    jest.useFakeTimers();
    service = build({ WORKER_MAINTENANCE_ENABLED: 'false' });
    service.onModuleInit();
    jest.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(syncLock.acquire).not.toHaveBeenCalled();
  });

  it('should run the first pass shortly after start', () => {
    jest.useFakeTimers();
    service.start(60 * 60 * 1000, 1000);
    jest.advanceTimersByTime(1000);
    expect(syncLock.acquire).toHaveBeenCalledTimes(1);
  });
});
