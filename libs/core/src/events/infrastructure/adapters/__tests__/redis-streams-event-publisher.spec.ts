/**
 * Redis Streams Event Publisher Unit Tests
 *
 * Covers the per-stream approximate MAXLEN retention cap (#1689): a stream
 * with a mapped threshold gets a TRIM option on XADD, an unmapped stream does
 * not.
 *
 * @module libs/core/src/events/infrastructure/adapters/__tests__
 */
import type { RedisClientType } from 'redis';
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
    await publisher.publish('events.master.deletion', makeEvent());

    expect(redisClient.xAdd).toHaveBeenCalledWith(
      'events.master.deletion',
      '*',
      expect.any(Object),
      expect.objectContaining({
        TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 10_000 },
      })
    );
  });

  it('omits the TRIM option for a stream without a configured cap', async () => {
    await publisher.publish('events.inbound.webhooks', makeEvent());

    const [, , , options] = redisClient.xAdd.mock.calls[0];
    expect(options).toEqual({});
  });
});
