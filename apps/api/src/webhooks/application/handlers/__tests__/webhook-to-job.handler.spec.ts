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
    expect(redis.xAdd).toHaveBeenCalledWith(
      DLQ,
      '*',
      expect.objectContaining({ eventId: 'evt-1' }),
      // Dead-letter writes are bounded like every other stream write (#2163).
      expect.objectContaining({ TRIM: expect.any(Object) })
    );
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

  describe('consumeLoop', () => {
    /**
     * Drive the private loop with `isRunning`/`abortController` seeded the way
     * `startConsumptionLoop` seeds them, but awaited — the production call is
     * fire-and-forget, which a test cannot join.
     */
    const runLoop = async (): Promise<void> => {
      /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- test: drive the private consume loop */
      (handler as any).abortController = new AbortController();
      (handler as any).isRunning = true;
      await (handler as any).consumeLoop();
      /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- test: end of the private-member access block */
    };

    const batch = (...ids: string[]): unknown => [
      { name: STREAM, messages: ids.map((id) => ({ id, message: fields() })) },
    ];

    it('should stop starting new messages when shutdown is signalled mid-batch (#1923 review)', async () => {
      // XREADGROUP COUNT 10 hands back a whole batch; the shutdown drain only
      // covers the one already running, so messages 2..N must not be started
      // against a quitting Redis client.
      const processed: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- test: stub private processMessage
      (handler as any).processMessage = (id: string): Promise<void> => {
        processed.push(id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- test: signal shutdown mid-batch
        (handler as any).abortController?.abort();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- test: signal shutdown mid-batch
        (handler as any).isRunning = false;
        return Promise.resolve();
      };
      redis.xReadGroup.mockResolvedValue(batch('msg-1', 'msg-2', 'msg-3'));

      await runLoop();

      expect(processed).toEqual(['msg-1']);
      expect(redis.xReadGroup).toHaveBeenCalledTimes(1);
    });

    it('should process every message of a batch while still running', async () => {
      const processed: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- test: stub private processMessage
      (handler as any).processMessage = (id: string): Promise<void> => {
        processed.push(id);
        if (processed.length === 3) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- test: end the otherwise-infinite loop
          (handler as any).isRunning = false;
        }
        return Promise.resolve();
      };
      redis.xReadGroup.mockResolvedValue(batch('msg-1', 'msg-2', 'msg-3'));

      await runLoop();

      expect(processed).toEqual(['msg-1', 'msg-2', 'msg-3']);
    });
  });

  describe('onModuleDestroy', () => {
    it('should quit the redis client', async () => {
      await handler.onModuleDestroy();

      expect(redis.quit).toHaveBeenCalledTimes(1);
    });

    // #1920: the old implementation slept a flat 2 s on every shutdown, which
    // cost ~2 s per int-spec teardown (77 of them) for nothing when no message
    // was in flight. Shutdown must now be immediate in that case.
    it('should not wait when no message is in flight', async () => {
      jest.useFakeTimers();
      try {
        const settled = jest.fn();
        const destroyed = handler.onModuleDestroy().then(settled);

        // No timer advance at all - only microtasks.
        await Promise.resolve();
        await destroyed;

        expect(settled).toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should wait for the message being processed before quitting', async () => {
      let releaseMessage: (() => void) | undefined;
      const inFlight = new Promise<void>((resolve) => {
        releaseMessage = resolve;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- test: seed the private in-flight handle
      (handler as any).inFlightMessage = inFlight;

      let done = false;
      const destroyed = handler.onModuleDestroy().then(() => {
        done = true;
      });

      await Promise.resolve();
      expect(done).toBe(false);
      expect(redis.quit).not.toHaveBeenCalled();

      releaseMessage?.();
      await destroyed;

      expect(done).toBe(true);
      expect(redis.quit).toHaveBeenCalledTimes(1);
    });

    it('should still shut down cleanly when the in-flight message fails', async () => {
      // The flat sleep this replaced could never reject; shutdown must not
      // start throwing just because the message being processed failed (the
      // consume loop owns that error and rethrows it for redelivery).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- test: seed the private in-flight handle
      (handler as any).inFlightMessage = Promise.reject(new Error('redis down'));

      await expect(handler.onModuleDestroy()).resolves.toBeUndefined();
      expect(redis.quit).toHaveBeenCalledTimes(1);
    });

    it('should give up on a stuck message after the bounded drain timeout', async () => {
      // A message that never settles must not block shutdown forever - the
      // wait is bounded, exactly as the old flat sleep bounded it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- test: seed the private in-flight handle
      (handler as any).inFlightMessage = new Promise<void>(() => {
        /* never settles */
      });

      jest.useFakeTimers();
      try {
        let done = false;
        const destroyed = handler.onModuleDestroy().then(() => {
          done = true;
        });

        await Promise.resolve();
        expect(done).toBe(false);

        await jest.advanceTimersByTimeAsync(2000);
        await destroyed;

        expect(done).toBe(true);
        expect(redis.quit).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
