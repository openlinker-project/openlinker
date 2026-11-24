import type { ConfigService } from '@nestjs/config';
import type { IBuyerDataRetentionService } from '@openlinker/core/orders';
import type { SyncLockPort } from '@openlinker/core/sync';
import {
  BUYER_DATA_RETENTION_LOCK_KEY,
  BuyerDataRetentionSweepService,
} from '../buyer-data-retention.service';

describe('BuyerDataRetentionSweepService', () => {
  let retention: jest.Mocked<IBuyerDataRetentionService>;
  let syncLock: jest.Mocked<SyncLockPort>;
  let service: BuyerDataRetentionSweepService;

  beforeEach(() => {
    retention = {
      preview: jest.fn(),
      runOnce: jest
        .fn()
        .mockResolvedValue({ hidden: 1, erased: 0, customersCleared: 0, budgetExhausted: false }),
    };
    syncLock = {
      acquire: jest.fn().mockResolvedValue('t'),
      release: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SyncLockPort>;
    service = new BuyerDataRetentionSweepService(retention, syncLock, {
      get: jest.fn(),
    } as unknown as ConfigService);
  });

  it('should run under a lease and always release it', async () => {
    await service.runOnce();
    expect(retention.runOnce).toHaveBeenCalledTimes(1);
    expect(syncLock.release).toHaveBeenCalledWith(BUYER_DATA_RETENTION_LOCK_KEY, 't');
  });

  it('should skip the tick when the lease is held elsewhere', async () => {
    syncLock.acquire.mockResolvedValue(null);
    await expect(service.runOnce()).resolves.toBeNull();
    expect(retention.runOnce).not.toHaveBeenCalled();
  });

  it('should never throw and still release on failure', async () => {
    retention.runOnce.mockRejectedValue(new Error('x'));
    await expect(service.runOnce()).resolves.toBeNull();
    expect(syncLock.release).toHaveBeenCalled();
  });
});
