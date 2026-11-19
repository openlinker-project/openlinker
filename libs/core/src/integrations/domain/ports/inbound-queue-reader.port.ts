/**
 * Inbound Queue Reader Port (#4179)
 *
 * A pull-based inbound transport: some platforms deliver change notifications
 * not over HTTP but into a queue the operator owns (Amazon SP-API delivers
 * only to Amazon SQS or EventBridge). An adapter that can read such a queue
 * implements this alongside its capability port; core drains it with the
 * same routing table a webhook uses (`IInboundRoutingPolicyService`), but not
 * the same durable path: see `IInboundQueueDrainService`.
 *
 * Contract:
 *   - `receiveInboundMessages` returns at most `maxMessages` messages, each
 *     already translated into neutral `CanonicalInboundEvent`s. A message the
 *     adapter cannot read carries `unreadable` and no events, so core can
 *     acknowledge it rather than receive it again for ever.
 *   - A message stays on the queue until `acknowledgeInboundMessages` is
 *     called with its `receiptHandle`; core acknowledges only after every
 *     event in it was routed, so a failed enqueue is received again.
 *   - Notifications are triggers, never data: the routed job always re-reads
 *     the entity from the platform, and the source's own poll stays the
 *     delivery guarantee.
 *
 * Advertised-without-dispatch: narrowed off the dispatched capability adapter
 * with {@link isInboundQueueReader}, never resolved by name.
 *
 * @module domain/ports
 */
import type { CanonicalInboundEvent } from '../types/canonical-inbound-event.types';

export interface InboundQueueMessage {
  /** The queue's own id for the message; used as the routing source event id. */
  readonly messageId: string;
  /** Handle needed to acknowledge (delete) the message. */
  readonly receiptHandle: string;
  readonly events: readonly CanonicalInboundEvent[];
  /** Why the message could not be read; set only when `events` is empty for that reason. */
  readonly unreadable?: string;
}

export interface InboundQueueReader {
  receiveInboundMessages(input: { readonly maxMessages: number }): Promise<InboundQueueMessage[]>;
  acknowledgeInboundMessages(receiptHandles: readonly string[]): Promise<void>;
}

export function isInboundQueueReader<T extends object>(adapter: T): adapter is T & InboundQueueReader {
  const candidate = adapter as Partial<InboundQueueReader>;
  return (
    typeof candidate.receiveInboundMessages === 'function' &&
    typeof candidate.acknowledgeInboundMessages === 'function'
  );
}
