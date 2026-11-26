/**
 * Inbound Queue Drain Service Interface (#4179)
 *
 * Drains a pull-based inbound queue (`InboundQueueReader`). Events go through
 * the same routing table a webhook uses, but NOT the same durable path: a
 * webhook commits its job inside the `sync_jobs` gate transaction (#2280,
 * ADR-049 decision 1), while this service enqueues through `route()`, i.e. the
 * `jobs.sync` Redis stream behind a `jobdedup:*` key. A message is
 * acknowledged only after every event in it was enqueued (or ungated, which
 * is deterministic); if routing one fails, the message stays and the queue
 * delivers it again. Once acknowledged, a stream entry lost before intake
 * loses the notification, so a notification is a low-latency TRIGGER and the
 * source's own order poll is the delivery guarantee. An unreadable message is
 * acknowledged and logged rather than received for ever.
 *
 * The reader arrives as an argument: the host resolves the connection's
 * adapter, so this service needs no integrations module edge.
 *
 * @module application/interfaces
 */
import type {
  InboundQueueDrainInput,
  InboundQueueDrainResult,
} from '../types/inbound-queue-drain.types';

export interface IInboundQueueDrainService {
  drain(input: InboundQueueDrainInput): Promise<InboundQueueDrainResult>;
}
