/**
 * In-Memory Event-Publisher Adapter
 *
 * Test-time-only adapter implementing `EventPublisherPort`. Records published
 * events in an internal `Map<streamName, Array<{ event, id }>>` so specs can
 * assert on the publish side-effects without running Redis. Returns synthetic
 * message IDs in the Redis Streams `<ms>-<seq>` shape (e.g. `1715690400000-0`)
 * so consumers that introspect the ID format don't surprise-fail.
 *
 * **Placement**: lives at `<context>/testing/` rather than
 * `<context>/infrastructure/adapters/` because it is never wired into a
 * production module graph — only consumed by `*.spec.ts` files in plugin
 * packages.
 *
 * @module libs/core/src/events/testing
 * @see {@link EventPublisherPort} for the port contract
 */
import type { EventPublisherPort } from '../domain/ports/event-publisher.port';
import type { EventEnvelope } from '../domain/types/event.types';

interface PublishedEntry {
  event: EventEnvelope;
  id: string;
}

interface FlatPublishedEntry {
  streamName: string;
  event: EventEnvelope;
  id: string;
}

export class InMemoryEventPublisherAdapter implements EventPublisherPort {
  private readonly streams = new Map<string, PublishedEntry[]>();
  private readonly publishOrder: FlatPublishedEntry[] = [];
  private sequence = 0;

  publish(streamName: string, event: EventEnvelope): Promise<string> {
    const id = `${Date.now()}-${this.sequence++}`;
    const bucket = this.streams.get(streamName) ?? [];
    bucket.push({ event, id });
    this.streams.set(streamName, bucket);
    this.publishOrder.push({ streamName, event, id });
    return Promise.resolve(id);
  }

  // ----- test helpers (not part of the port contract) -----

  clear(): void {
    this.streams.clear();
    this.publishOrder.length = 0;
    this.sequence = 0;
  }

  /**
   * Events published to a single stream, in publish order. Returns an empty
   * array when nothing has been published to the stream.
   */
  getPublishedEvents(streamName: string): EventEnvelope[] {
    return (this.streams.get(streamName) ?? []).map((entry) => entry.event);
  }

  /**
   * Flat list of all published entries across every stream, in publish order.
   * Use when asserting on cross-stream sequencing or total counts.
   */
  published(): ReadonlyArray<FlatPublishedEntry> {
    return this.publishOrder;
  }
}
