/**
 * Inventory Movement Retention Service Unit Tests (#3565)
 *
 * Pins: the lease is acquired and always released, a lost lease is a no-op skip,
 * the window comes from Operational Settings, batching continues while a batch is
 * full and stops on the first short one, the per-run budget is respected, only
 * the movement ledger is pruned, and an error never escapes `runOnce()`.
 *
 * @module apps/worker/src/maintenance
 */
import type { ConfigService } from '@nestjs/config';
import type { IInventoryMovementService } from '@openlinker/core/inventory';
import type {
  IOperationalSettingsService,
  OperationalSettingsView,
} from '@openlinker/core/operational-settings';
import type { SyncLockPort } from '@openlinker/core/sync';
import {
  INVENTORY_MOVEMENT_MAX_BATCHES_PER_RUN,
  INVENTORY_MOVEMENT_PRUNE_BATCH_SIZE,
  INVENTORY_MOVEMENT_RETENTION_LOCK_KEY,
  InventoryMovementRetentionService,
} from '../inventory-movement-retention.service';

function settingsView(days: number): OperationalSettingsView {
  const field = (value: number) => ({
    value,
    source: 'default' as const,
    workerMayDiffer: true,
    recommendedMax: 730,
    recommendedReason: '',
    absoluteMax: 1825,
    absoluteReason: '',
    aboveRecommended: false,
  });
  return { inventoryMovementRetentionDays: field(days) } as unknown as OperationalSettingsView;
}

describe('InventoryMovementRetentionService', () => {
  let movements: jest.Mocked<IInventoryMovementService>;
  let settings: jest.Mocked<IOperationalSettingsService>;
  let syncLock: jest.Mocked<SyncLockPort>;
  let service: InventoryMovementRetentionService;

  const build = (overrides: Record<string, string> = {}): InventoryMovementRetentionService =>
    new InventoryMovementRetentionService(movements, settings, syncLock, {
      get: jest.fn((key: string, fallback?: string) => overrides[key] ?? fallback),
    } as unknown as ConfigService);

  beforeEach(() => {
    movements = {
      pruneOlderThan: jest.fn().mockResolvedValue(0),
      listMovements: jest.fn(),
      countMovements: jest.fn(),
    } as unknown as jest.Mocked<IInventoryMovementService>;
    settings = {
      resolve: jest.fn().mockResolvedValue(settingsView(365)),
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
    jest.useRealTimers();
  });

  it('should skip the run without pruning when the lease is not acquired', async () => {
    syncLock.acquire.mockResolvedValue(null);

    await expect(service.runOnce()).resolves.toBeNull();

    expect(settings.resolve).not.toHaveBeenCalled();
    expect(movements.pruneOlderThan).not.toHaveBeenCalled();
    expect(syncLock.release).not.toHaveBeenCalled();
  });

  it('should release the lease it acquired even when the pass throws', async () => {
    settings.resolve.mockRejectedValue(new Error('db down'));

    await expect(service.runOnce()).resolves.toBeNull();

    expect(syncLock.release).toHaveBeenCalledWith(INVENTORY_MOVEMENT_RETENTION_LOCK_KEY, 'token-1');
  });

  it('should prune against a cutoff derived from the resolved retention window', async () => {
    settings.resolve.mockResolvedValue(settingsView(90));
    const before = Date.now();

    await service.runOnce();

    const cutoff = (movements.pruneOlderThan.mock.calls[0][0]).getTime();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(before - ninetyDays - 1000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - ninetyDays + 1000);
    expect(movements.pruneOlderThan.mock.calls[0][1]).toBe(INVENTORY_MOVEMENT_PRUNE_BATCH_SIZE);
  });

  it('should keep batching while a batch comes back full and stop on the first short one', async () => {
    movements.pruneOlderThan
      .mockResolvedValueOnce(INVENTORY_MOVEMENT_PRUNE_BATCH_SIZE)
      .mockResolvedValueOnce(INVENTORY_MOVEMENT_PRUNE_BATCH_SIZE)
      .mockResolvedValueOnce(7);

    const result = await service.runOnce();

    expect(movements.pruneOlderThan).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      deleted: 2 * INVENTORY_MOVEMENT_PRUNE_BATCH_SIZE + 7,
      budgetExhausted: false,
    });
  });

  it('should report budgetExhausted and stop after the per-run batch budget', async () => {
    movements.pruneOlderThan.mockResolvedValue(INVENTORY_MOVEMENT_PRUNE_BATCH_SIZE);

    const result = await service.runOnce();

    expect(movements.pruneOlderThan).toHaveBeenCalledTimes(INVENTORY_MOVEMENT_MAX_BATCHES_PER_RUN);
    expect(result?.budgetExhausted).toBe(true);
  });

  it('should not start the loop when WORKER_MAINTENANCE_ENABLED=false', () => {
    jest.useFakeTimers();
    const disabled = build({ WORKER_MAINTENANCE_ENABLED: 'false' });
    disabled.onModuleInit();

    jest.advanceTimersByTime(2 * 60 * 60 * 1000);

    expect(syncLock.acquire).not.toHaveBeenCalled();
    disabled.stop();
  });

  it('should run one sweep shortly after start, not only an hour later', async () => {
    jest.useFakeTimers();
    const spy = jest.spyOn(service, 'runOnce').mockResolvedValue(null);

    service.start();
    expect(spy).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(61_000);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should cancel the pending first sweep on stop', async () => {
    jest.useFakeTimers();
    const spy = jest.spyOn(service, 'runOnce').mockResolvedValue(null);

    service.start();
    service.stop();
    await jest.advanceTimersByTimeAsync(120_000);

    expect(spy).not.toHaveBeenCalled();
  });
});
