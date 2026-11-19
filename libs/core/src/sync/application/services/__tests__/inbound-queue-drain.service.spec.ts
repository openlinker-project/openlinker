/**
 * InboundQueueDrainService tests (#4179)
 *
 * @module application/services/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CanonicalInboundEvent, InboundQueueReader } from '@openlinker/core/integrations';

import type { IInboundRoutingPolicyService } from '../../interfaces/inbound-routing-policy.service.interface';
import { InboundQueueDrainService } from '../inbound-queue-drain.service';

const connection = { id: 'conn-amz', platformType: 'amazon' } as Connection;
const orderEvent = (id: string): CanonicalInboundEvent => ({ domain: 'order', externalId: id, eventType: 'OrderStatusChange' });

function setup(messages: Awaited<ReturnType<InboundQueueReader['receiveInboundMessages']>>): {
  service: InboundQueueDrainService;
  reader: jest.Mocked<InboundQueueReader>;
  route: jest.Mock;
} {
  const route = jest.fn().mockResolvedValue({ status: 'enqueued', jobId: 'j', jobType: 'marketplace.order.sync' });
  const reader = {
    receiveInboundMessages: jest.fn().mockResolvedValue(messages),
    acknowledgeInboundMessages: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InboundQueueDrainService({ route } as unknown as IInboundRoutingPolicyService);
  return { service, reader, route };
}

describe('InboundQueueDrainService', () => {
  it('should route each event with the message id and acknowledge the message', async () => {
    const { service, reader, route } = setup([
      { messageId: 'm1', receiptHandle: 'h1', events: [orderEvent('302-1')] },
    ]);

    const result = await service.drain({ connection, supportedCapabilities: ['OrderSource'], reader, maxMessages: 10 });

    expect(reader.receiveInboundMessages).toHaveBeenCalledWith({ maxMessages: 10 });
    expect(route).toHaveBeenCalledWith(orderEvent('302-1'), connection, ['OrderSource'], 'm1');
    expect(reader.acknowledgeInboundMessages).toHaveBeenCalledWith(['h1']);
    expect(result).toEqual({ received: 1, enqueued: 1, ungated: 0, unreadable: 0, acknowledged: 1, retained: 0 });
  });

  it('should suffix the event position when one message carries several events', async () => {
    const { service, reader, route } = setup([
      { messageId: 'm1', receiptHandle: 'h1', events: [orderEvent('a'), orderEvent('b')] },
    ]);
    await service.drain({ connection, supportedCapabilities: [], reader, maxMessages: 10 });
    expect(route.mock.calls.map((call: unknown[]) => call[3])).toEqual(['m1:0', 'm1:1']);
  });

  it('should leave a message on the queue when routing one of its events fails', async () => {
    const { service, reader, route } = setup([
      { messageId: 'm1', receiptHandle: 'h1', events: [orderEvent('a')] },
      { messageId: 'm2', receiptHandle: 'h2', events: [orderEvent('b')] },
    ]);
    route.mockRejectedValueOnce(new Error('redis down'));

    const result = await service.drain({ connection, supportedCapabilities: [], reader, maxMessages: 10 });

    expect(reader.acknowledgeInboundMessages).toHaveBeenCalledWith(['h2']);
    expect(result).toMatchObject({ retained: 1, acknowledged: 1, enqueued: 1 });
  });

  it('should acknowledge an ungated event, which retrying cannot change', async () => {
    const { service, reader, route } = setup([{ messageId: 'm1', receiptHandle: 'h1', events: [orderEvent('a')] }]);
    route.mockResolvedValueOnce({ status: 'ungated', domain: 'order', requiredCapability: 'OrderSource' });
    const result = await service.drain({ connection, supportedCapabilities: [], reader, maxMessages: 10 });
    expect(result).toMatchObject({ ungated: 1, acknowledged: 1 });
  });

  it('should acknowledge an unreadable message instead of receiving it for ever', async () => {
    const { service, reader, route } = setup([
      { messageId: 'm1', receiptHandle: 'h1', events: [], unreadable: 'not JSON' },
    ]);
    const result = await service.drain({ connection, supportedCapabilities: [], reader, maxMessages: 10 });
    expect(route).not.toHaveBeenCalled();
    expect(reader.acknowledgeInboundMessages).toHaveBeenCalledWith(['h1']);
    expect(result).toMatchObject({ unreadable: 1, acknowledged: 1 });
  });

  it('should not call acknowledge on an empty queue', async () => {
    const { service, reader } = setup([]);
    await service.drain({ connection, supportedCapabilities: [], reader, maxMessages: 10 });
    expect(reader.acknowledgeInboundMessages).not.toHaveBeenCalled();
  });
});
