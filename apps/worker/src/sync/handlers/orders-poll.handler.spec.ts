/**
 * OrdersPollHandler spec (#3991): a poll without cursorKey must use the connection's own
 * plugin cursor key, never another platform's.
 */
import type { SyncJob } from '@openlinker/core/sync';
import type { SchedulerTaskConfig } from '@openlinker/core/sync';
import { OrdersPollHandler } from './orders-poll.handler';

function makeJob(payload: Record<string, unknown>): SyncJob {
  return {
    id: 'job-1',
    jobType: 'marketplace.orders.poll',
    connectionId: 'conn-1',
    payload,
  } as unknown as SyncJob;
}

function makeTask(platformType: string, cursorKey: string): SchedulerTaskConfig {
  return {
    taskId: `${platformType}-orders-poll`,
    platformType,
    jobType: 'marketplace.orders.poll',
    cronExpression: '* * * * *',
    generatePayload: () => ({ schemaVersion: 1, cursorKey, limit: 100 }),
    generateIdempotencyKey: () => 'k',
  } as SchedulerTaskConfig;
}

describe('OrdersPollHandler', () => {
  const ingestOrders = jest.fn();
  const get = jest.fn();
  const tasks: SchedulerTaskConfig[] = [
    makeTask('allegro', 'allegro.orders.lastEventId'),
    makeTask('woocommerce', 'woocommerce.orders.lastModifiedAfter'),
  ];
  const handler = new OrdersPollHandler(
    { ingestOrders } as never,
    { get } as never,
    { getAll: () => tasks } as never
  );

  beforeEach(() => {
    jest.clearAllMocks();
    ingestOrders.mockResolvedValue({ fetched: 0, enqueued: 0, committed: true });
  });

  it('should use the explicit cursorKey when the payload carries one', async () => {
    await handler.execute(makeJob({ cursorKey: 'custom.key' }));
    expect(get).not.toHaveBeenCalled();
    expect(ingestOrders).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ cursorKey: 'custom.key' })
    );
  });

  it("should use the connection's plugin cursor key when the payload has none", async () => {
    get.mockResolvedValue({ id: 'conn-1', platformType: 'woocommerce' });
    await handler.execute(makeJob({}));
    expect(ingestOrders).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ cursorKey: 'woocommerce.orders.lastModifiedAfter' })
    );
  });

  it('should refuse to poll when the plugin declares no cursor key', async () => {
    get.mockResolvedValue({ id: 'conn-1', platformType: 'shopify' });
    const result = await handler.execute(makeJob({}));
    expect(result).toEqual({ outcome: 'business_failure' });
    expect(ingestOrders).not.toHaveBeenCalled();
  });
});
