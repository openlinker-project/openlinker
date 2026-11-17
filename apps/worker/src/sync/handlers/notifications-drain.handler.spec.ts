/**
 * NotificationsDrainHandler tests (#4179)
 *
 * @module apps/worker/src/sync/handlers
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { SyncJobExecutionError, type IInboundQueueDrainService, type SyncJobEntity } from '@openlinker/core/sync';

import { NotificationsDrainHandler } from './notifications-drain.handler';

const job = {
  id: 'job-1',
  jobType: 'marketplace.notifications.drain',
  connectionId: 'conn-amz',
  payload: { schemaVersion: 1, maxMessages: 5 },
} as unknown as SyncJobEntity;

const reader = { receiveInboundMessages: jest.fn(), acknowledgeInboundMessages: jest.fn(), listOrderFeed: jest.fn() };

function setup(adapter: object): { handler: NotificationsDrainHandler; drain: jest.Mock } {
  const integrations = {
    getAdapter: jest.fn().mockResolvedValue({
      connection: { id: 'conn-amz' },
      metadata: { supportedCapabilities: ['OrderSource'] },
    }),
    getCapabilityAdapter: jest.fn().mockResolvedValue(adapter),
  } as unknown as IIntegrationsService;
  const drain = jest.fn().mockResolvedValue({ received: 0, enqueued: 0, ungated: 0, unreadable: 0, acknowledged: 0, retained: 0 });
  return { handler: new NotificationsDrainHandler(integrations, { drain } as IInboundQueueDrainService), drain };
}

describe('NotificationsDrainHandler', () => {
  it('should drain the connection queue through the order source adapter', async () => {
    const { handler, drain } = setup(reader);

    await expect(handler.execute(job)).resolves.toEqual({ outcome: 'ok' });
    expect(drain).toHaveBeenCalledWith({
      connection: { id: 'conn-amz' },
      supportedCapabilities: ['OrderSource'],
      reader,
      maxMessages: 5,
    });
  });

  it('should end as a business failure when the adapter reads no queue', async () => {
    const { handler, drain } = setup({ listOrderFeed: jest.fn() });
    await expect(handler.execute(job)).resolves.toEqual({ outcome: 'business_failure' });
    expect(drain).not.toHaveBeenCalled();
  });

  it('should rethrow a failed drain as a retryable job error', async () => {
    const { handler, drain } = setup(reader);
    drain.mockRejectedValue(new Error('SQS unreachable'));
    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
