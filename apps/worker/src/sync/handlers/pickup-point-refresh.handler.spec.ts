/**
 * Pickup-point refresh handler unit tests (#849).
 */
import type { IPickupPointRefreshService } from '@openlinker/core/shipping';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import { PickupPointRefreshHandler } from './pickup-point-refresh.handler';

function makeJob(): SyncJob {
  return {
    id: 'job-1',
    jobType: 'shipping.pickupPoint.refreshFrequent',
    connectionId: 'conn-1',
    payload: { schemaVersion: 1 },
    idempotencyKey: 'shipping:conn-1:pickupPoints:refresh:2026-06-05-03-00',
    status: 'running',
    attempts: 1,
    maxAttempts: 10,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SyncJob;
}

describe('PickupPointRefreshHandler', () => {
  let refreshService: jest.Mocked<IPickupPointRefreshService>;
  let handler: PickupPointRefreshHandler;

  beforeEach(() => {
    refreshService = { refreshFrequentForConnection: jest.fn() };
    handler = new PickupPointRefreshHandler(refreshService);
  });

  it('delegates to the refresh service and returns ok', async () => {
    refreshService.refreshFrequentForConnection.mockResolvedValue({ refreshed: 3, failed: 0 });

    const result = await handler.execute(makeJob());

    expect(refreshService.refreshFrequentForConnection).toHaveBeenCalledWith('conn-1');
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('wraps a service failure in SyncJobExecutionError', async () => {
    refreshService.refreshFrequentForConnection.mockRejectedValue(new Error('redis down'));

    await expect(handler.execute(makeJob())).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
