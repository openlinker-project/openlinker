/**
 * Redis Streams Event Publisher Unit Tests
 *
 * Covers retention on the publish path. The contract inverted in #2163: this
 * adapter used to own a per-stream cap map and leave an unmapped stream
 * **unbounded**, which is how four of seven streams came to grow forever. The
 * policy now lives in `@openlinker/shared/redis` and applies to every stream,
 * mapped or not — so the assertion that matters is the one about a stream this
 * adapter has never heard of.
 *
 * @module libs/core/src/events/infrastructure/adapters/__tests__
 */
import type { RedisClientType } from 'redis';
import { REDIS_STREAM_NAMES } from '@openlinker/shared/redis';
import { RedisStreamsEventPublisher } from '../redis-streams-event-publisher';
import type { EventEnvelope } from '../../../domain/types/event.types';

describe('RedisStreamsEventPublisher', () => {
  let redisClient: jest.Mocked<RedisClientType>;
  let publisher: RedisStreamsEventPublisher;

  const makeEvent = (): EventEnvelope => ({
    eventId: 'evt-1',
    eventType: 'master.variant.stale',
    payloadJson: '{}',
    occurredAt: '2026-07-27T00:00:00.000Z',
    publishedAt: '2026-07-27T00:00:00.000Z',
  });

  beforeEach(() => {
    redisClient = {
      xAdd: jest.fn().mockResolvedValue('1-0'),
    } as unknown as jest.Mocked<RedisClientType>;

    publisher = new RedisStreamsEventPublisher(redisClient);
  });

  it('passes a MAXLEN TRIM option for a stream with a configured cap', async () => {
    await publisher.publish(REDIS_STREAM_NAMES.masterDeletion, makeEvent());

    expect(redisClient.xAdd).toHaveBeenCalledWith(
      REDIS_STREAM_NAMES.masterDeletion,
      '*',
      expect.any(Object),
      expect.objectContaining({
        TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 10_000 },
      })
    );
  });

  it('passes a TRIM option for the highest-volume stream', async () => {
    await publisher.publish(REDIS_STREAM_NAMES.inboundWebhooks, makeEvent());

    expect(redisClient.xAdd).toHaveBeenCalledWith(
      REDIS_STREAM_NAMES.inboundWebhooks,
      '*',
      expect.any(Object),
      expect.objectContaining({
        TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 50_000 },
      })
    );
  });

  it('still bounds a stream it has no entry for', async () => {
    // The #2163 inversion. Previously this asserted `options` was `{}` — an
    // unmapped stream was left to grow forever, which is exactly how
    // `events.inbound.webhooks` and `jobs.sync` became unbounded.
    await publisher.publish('some.brand.new.stream', makeEvent());

    const [, , , options] = redisClient.xAdd.mock.calls[0];
    expect(options).toEqual({
      TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 10_000 },
    });
  });
});
