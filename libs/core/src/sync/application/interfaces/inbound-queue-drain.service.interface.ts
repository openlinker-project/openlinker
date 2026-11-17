/**
 * Inbound Queue Drain Service Interface (#4179)
 *
 * Drains a pull-based inbound queue (`InboundQueueReader`) through the same
 * routing a webhook takes. A message is acknowledged only after every event
 * in it was routed (enqueued, or ungated, which is deterministic); if routing
 * one fails, the message stays and the queue delivers it again. An unreadable
 * message is acknowledged and logged rather than received for ever.
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
