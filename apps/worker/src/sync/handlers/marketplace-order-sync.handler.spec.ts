/**
 * Marketplace Order Sync Handler Tests
 *
 * Pins that the refund observation that follows an ingestion is best-effort:
 * a failure inside it must neither fail nor retry the ingestion that already
 * succeeded.
 *
 * @module apps/worker/src/sync/handlers
 */
import type { SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type {
  IOrderIngestionService,
  IOrderRefundObservationService,
} from '@openlinker/core/orders';
import { MarketplaceOrderSyncHandler } from './marketplace-order-sync.handler';

describe('MarketplaceOrderSyncHandler', () => {
  let syncOrderFromSource: jest.Mock;
  let observeSourceRefunds: jest.Mock;
  let handler: MarketplaceOrderSyncHandler;

  const job = {
    id: 'job-1',
    jobType: 'marketplace.order.sync',
    connectionId: 'conn-1',
    payload: { schemaVersion: 1, externalOrderId: 'ext-1', eventKey: 'evt-1' },
  } as unknown as SyncJob;

  beforeEach(() => {
    syncOrderFromSource = jest.fn().mockResolvedValue([]);
    observeSourceRefunds = jest.fn().mockResolvedValue({});
    handler = new MarketplaceOrderSyncHandler(
      { syncOrderFromSource } as unknown as IOrderIngestionService,
      { observeSourceRefunds } as unknown as IOrderRefundObservationService
    );
  });

  it('should observe refunds after a successful ingestion', async () => {
    const result = await handler.execute(job);

    expect(result).toEqual({ outcome: 'ok' });
    expect(observeSourceRefunds).toHaveBeenCalledWith('conn-1', 'ext-1');
  });

  it('should still report ok when the refund observation throws', async () => {
    observeSourceRefunds.mockRejectedValue(new Error('payments scope missing'));

    await expect(handler.execute(job)).resolves.toEqual({ outcome: 'ok' });
    expect(syncOrderFromSource).toHaveBeenCalledTimes(1);
  });

  it('should fail the job and skip the observation when the ingestion itself throws', async () => {
    syncOrderFromSource.mockRejectedValue(new Error('boom'));

    await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    expect(observeSourceRefunds).not.toHaveBeenCalled();
  });
});
