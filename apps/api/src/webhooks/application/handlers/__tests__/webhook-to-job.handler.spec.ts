/**
 * Webhook-to-Job Handler Unit Tests
 *
 * Tests the thin dispatcher flow (ADR-015 / #903): resolve connection →
 * resolve plugin translator → translate → core routing policy → enqueue or
 * dead-letter. No platform string-matching lives in the handler anymore.
 *
 * @module apps/api/src/webhooks/application/handlers/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { WebhookToJobHandler } from '../webhook-to-job.handler';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN,
  type CanonicalInboundEvent,
  type AdapterMetadata,
} from '@openlinker/core/integrations';
import { INBOUND_ROUTING_POLICY_TOKEN } from '@openlinker/core/sync';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { ConnectionDisabledException } from '@openlinker/core/identifier-mapping';
import { WEBHOOK_DELIVERY_REPOSITORY_TOKEN } from '@openlinker/core/webhooks';
import { REDIS_CLIENT_BLOCKING_TOKEN } from '../../../webhooks.tokens';

const STREAM = 'events.inbound.webhooks';
const DLQ = 'events.inbound.webhooks.dead';
const GROUP = 'webhook-handler';

describe('WebhookToJobHandler (dispatcher)', () => {
  let handler: WebhookToJobHandler;
  let redis: {
    xGroupCreate: jest.Mock;
    xReadGroup: jest.Mock;
    xAck: jest.Mock;
    xAdd: jest.Mock;
    quit: jest.Mock;
  };
  let getAdapter: jest.Mock;
  let translate: jest.Mock;
  let registryGet: jest.Mock;
  let route: jest.Mock;
  let upsert: jest.Mock;

  const metadata: AdapterMetadata = {
    adapterKey: 'prestashop.webservice.v1',
    platformType: 'prestashop',
    supportedCapabilities: ['OrderSource'],
  };
  const connection = { id: 'conn-1', platformType: 'prestashop' } as unknown as Connection;
  const canonicalOrder: CanonicalInboundEvent = {
    domain: 'order',
    externalId: '42',
    eventType: 'created',
  };

  const fields = (overrides: Record<string, string> = {}): Record<string, string> => ({
    eventId: 'evt-1',
    eventType: 'inbound.webhook.order.created',
    payloadJson: JSON.stringify({ objectType: 'order', externalId: '42', payload: {} }),
    metadataJson: JSON.stringify({ provider: 'prestashop', connectionId: 'conn-1' }),
    occurredAt: '2026-01-01T00:00:00.000Z',
    publishedAt: '2026-01-01T00:00:01.000Z',
    ...overrides,
  });

  const process = (id: string, f: Record<string, string>): Promise<void> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- test: invoke private processMessage
    (handler as any).processMessage(id, f);

  beforeEach(async () => {
    redis = {
      xGroupCreate: jest.fn(),
      xReadGroup: jest.fn(),
      xAck: jest.fn(),
      xAdd: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    getAdapter = jest.fn().mockResolvedValue({ connection, metadata });
    translate = jest.fn().mockReturnValue(canonicalOrder);
    registryGet = jest.fn().mockReturnValue({ translate });
    route = jest
      .fn()
      .mockResolvedValue({ status: 'enqueued', jobId: 'job-1', jobType: 'marketplace.order.sync' });
    upsert = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookToJobHandler,
        { provide: REDIS_CLIENT_BLOCKING_TOKEN, useValue: redis },
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: { getAdapter } },
        { provide: WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN, useValue: { get: registryGet } },
        { provide: INBOUND_ROUTING_POLICY_TOKEN, useValue: { route } },
        {
          provide: WEBHOOK_DELIVERY_REPOSITORY_TOKEN,
          useValue: { upsert, findById: jest.fn(), findMany: jest.fn() },
        },
      ],
    }).compile();

    handler = module.get<WebhookToJobHandler>(WebhookToJobHandler);
  });

  it('should dispatch an order webhook through translator + policy and ACK', async () => {
    await process('msg-1', fields());

    expect(getAdapter).toHaveBeenCalledWith('conn-1');
    expect(registryGet).toHaveBeenCalledWith('prestashop.webservice.v1');
    expect(route).toHaveBeenCalledWith(canonicalOrder, connection, ['OrderSource'], 'evt-1');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'job_enqueued',
        downstreamJobType: 'marketplace.order.sync',
        downstreamJobId: 'job-1',
      })
    );
    expect(redis.xAck).toHaveBeenCalledWith(STREAM, GROUP, 'msg-1');
    expect(redis.xAdd).not.toHaveBeenCalled();
  });

  it('should skip test.* events without resolving the connection', async () => {
    await process('msg-1', fields({ eventType: 'inbound.webhook.test.ping' }));

    expect(getAdapter).not.toHaveBeenCalled();
    expect(route).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'received' }));
    expect(redis.xAck).toHaveBeenCalledWith(STREAM, GROUP, 'msg-1');
  });

  it('should dead-letter when no translator is registered for the adapter', async () => {
    registryGet.mockReturnValue(undefined);

    await process('msg-1', fields());

    expect(route).not.toHaveBeenCalled();
    expect(redis.xAdd).toHaveBeenCalledWith(DLQ, '*', expect.objectContaining({ eventId: 'evt-1' }));
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'deadlettered',
        dlqReason: expect.stringContaining('no-translator'),
      })
    );
    expect(redis.xAck).toHaveBeenCalledWith(STREAM, GROUP, 'msg-1');
  });

  it('should dead-letter when the translator cannot decode the event', async () => {
    translate.mockReturnValue(null);

    await process(
      'msg-1',
      fields({ payloadJson: JSON.stringify({ objectType: 'category', externalId: '1' }) })
    );

    expect(route).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'deadlettered',
        dlqReason: expect.stringContaining('undecodable'),
      })
    );
    expect(redis.xAck).toHaveBeenCalledWith(STREAM, GROUP, 'msg-1');
  });

  it('should dead-letter when the routing policy gates the event out', async () => {
    route.mockResolvedValue({ status: 'ungated', domain: 'order', requiredCapability: 'OrderSource' });

    await process('msg-1', fields());

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'deadlettered',
        dlqReason: expect.stringContaining('ungated'),
      })
    );
    expect(redis.xAck).toHaveBeenCalledWith(STREAM, GROUP, 'msg-1');
  });

  it('should dead-letter when the connection is permanently unroutable (disabled/not-found)', async () => {
    getAdapter.mockRejectedValue(new ConnectionDisabledException('conn-1'));

    await process('msg-1', fields());

    expect(registryGet).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'deadlettered',
        dlqReason: expect.stringContaining('connection-unavailable'),
      })
    );
    expect(redis.xAck).toHaveBeenCalledWith(STREAM, GROUP, 'msg-1');
  });

  it('should NOT dead-letter on a TRANSIENT connection-resolution error — rethrow for redelivery', async () => {
    // A non-domain error (e.g. DB blip) must not silently drop the webhook.
    getAdapter.mockRejectedValue(new Error('db connection lost'));

    await expect(process('msg-1', fields())).rejects.toThrow('db connection lost');
    expect(redis.xAdd).not.toHaveBeenCalled();
    expect(redis.xAck).not.toHaveBeenCalled();
  });

  it('should NOT ack (rethrow for redelivery) on a transient routing error', async () => {
    route.mockRejectedValue(new Error('redis down'));

    await expect(process('msg-1', fields())).rejects.toThrow('redis down');
    expect(redis.xAck).not.toHaveBeenCalled();
  });

  describe('onModuleDestroy', () => {
    it('should quit the redis client', async () => {
      jest.useFakeTimers();
      try {
        const p = handler.onModuleDestroy();
        await jest.advanceTimersByTimeAsync(2000);
        await p;
        expect(redis.quit).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
