/**
 * InMemoryEventPublisherAdapter Tests
 *
 * @module libs/core/src/events/testing
 */
import type { EventEnvelope } from '../../domain/types/event.types';
import { InMemoryEventPublisherAdapter } from '../in-memory-event-publisher.adapter';

function buildEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: 'evt-1',
    eventType: 'test.event',
    payloadJson: '{}',
    occurredAt: '2026-05-14T12:00:00.000Z',
    publishedAt: '2026-05-14T12:00:00.000Z',
    ...overrides,
  };
}

describe('InMemoryEventPublisherAdapter', () => {
  it('should return a Redis-Streams-shaped ID on publish', async () => {
    const publisher = new InMemoryEventPublisherAdapter();

    const id = await publisher.publish('events.inbound.webhooks', buildEnvelope());

    expect(id).toMatch(/^\d+-\d+$/);
  });

  it('should record the published event for assertion via getPublishedEvents', async () => {
    const publisher = new InMemoryEventPublisherAdapter();
    const envelope = buildEnvelope({ eventId: 'evt-recorded' });

    await publisher.publish('events.inbound.webhooks', envelope);

    expect(publisher.getPublishedEvents('events.inbound.webhooks')).toEqual([envelope]);
  });

  it('should isolate events by stream name', async () => {
    const publisher = new InMemoryEventPublisherAdapter();
    const a = buildEnvelope({ eventId: 'a' });
    const b = buildEnvelope({ eventId: 'b' });

    await publisher.publish('stream.A', a);
    await publisher.publish('stream.B', b);

    expect(publisher.getPublishedEvents('stream.A')).toEqual([a]);
    expect(publisher.getPublishedEvents('stream.B')).toEqual([b]);
    expect(publisher.getPublishedEvents('stream.empty')).toEqual([]);
  });

  it('should expose a flat, in-publish-order list via published()', async () => {
    const publisher = new InMemoryEventPublisherAdapter();
    const a = buildEnvelope({ eventId: 'a' });
    const b = buildEnvelope({ eventId: 'b' });
    const c = buildEnvelope({ eventId: 'c' });

    await publisher.publish('stream.A', a);
    await publisher.publish('stream.B', b);
    await publisher.publish('stream.A', c);

    const flat = publisher.published();
    expect(flat).toHaveLength(3);
    expect(flat.map((entry) => entry.event.eventId)).toEqual(['a', 'b', 'c']);
    expect(flat.map((entry) => entry.streamName)).toEqual(['stream.A', 'stream.B', 'stream.A']);
    // IDs must be strictly monotonic in sequence suffix.
    const sequences = flat.map((entry) => Number(entry.id.split('-')[1]));
    expect(sequences).toEqual([0, 1, 2]);
  });

  it('should reset all state on clear()', async () => {
    const publisher = new InMemoryEventPublisherAdapter();
    await publisher.publish('stream.A', buildEnvelope());

    publisher.clear();

    expect(publisher.getPublishedEvents('stream.A')).toEqual([]);
    expect(publisher.published()).toEqual([]);
    // Sequence counter resets too — next publish should start from suffix 0.
    const nextId = await publisher.publish('stream.A', buildEnvelope());
    expect(nextId.split('-')[1]).toBe('0');
  });
});
