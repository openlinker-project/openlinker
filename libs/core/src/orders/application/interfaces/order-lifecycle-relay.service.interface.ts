/**
 * Order Lifecycle Relay Service Interface
 *
 * The Posture-A lifecycle relay (#1157 / ADR-027): propagates a lifecycle event
 * authored by one participant of an order to the order's *other* participants,
 * via the single `OrderStatusWriteback` capability (guard-dispatched, no
 * platform-type branching). Best-effort — OL owns no canonical status; it
 * forwards facts authored by authoritative systems and reports a per-target
 * outcome (it never throws on a single participant's failure).
 *
 * @module libs/core/src/orders/application/interfaces
 * @see {@link OrderStatusWriteback} for the per-participant writeback contract
 */
import type {
  OrderLifecycleEvent,
  OrderWritebackOutcome,
} from '../../domain/types/order-lifecycle-event.types';

/**
 * The relay-facing projection of {@link OrderLifecycleEvent}: the same union,
 * minus the per-participant `externalOrderId` the relay resolves itself.
 *
 * **Derived, never restated (#2286).** This union used to be hand-written, so a
 * new `OrderLifecycleEvent` member did not widen the relay input and the relay's
 * own branch kept compiling — defeating the exhaustiveness guard everywhere else.
 * The distribution over the union (rather than a plain `Omit`) is what preserves
 * the discriminated shape: a non-distributed `Omit` would collapse the members
 * into one object with optional fields, which narrows on `type` but no longer
 * fails to compile when a member is added.
 */
export type OrderLifecycleRelayEvent<E = OrderLifecycleEvent> = E extends unknown
  ? Omit<E, 'externalOrderId'>
  : never;

/**
 * A lifecycle event to relay, keyed on the internal order. The relay resolves
 * each target participant's own `externalOrderId`, so the caller supplies only
 * the neutral event + its payload.
 */
export interface OrderLifecycleRelayInput {
  internalOrderId: string;
  /** The participant that authored the event — excluded from the targets (self-echo suppression at the participant level). */
  originConnectionId: string;
  event: OrderLifecycleRelayEvent;
}

/**
 * Why an `unsupported` target was skipped (#1947).
 *
 * `outcome: 'unsupported'` conflates two conditions a caller must treat
 * differently, and until now they were distinguishable only by a free-text
 * `detail` string:
 *
 * - `no-capability` — STRUCTURAL. This participant exposes no order-writeback
 *   capability (or has it deliberately gated off). There is nothing to retry;
 *   waiting will not help.
 * - `adapter-unresolved` — TRANSIENT. The adapter could not be constructed:
 *   connection disabled, not found, credentials unresolvable. The same call may
 *   well succeed after a re-auth, so a caller that keys durable state on the
 *   outcome must NOT record this as "done".
 *
 * Deliberately a separate field rather than two new `OrderWritebackOutcome`
 * values: that union is the adapter-facing contract, and a new value there would
 * silently fall into existing `default:`/`switch` arms — notably
 * `ShipmentDispatchNotificationService.resolveSourceOutcome`, whose default maps
 * to `'absent'` and advances the shipment past its at-most-once gate.
 */
export const OrderWritebackUnsupportedReasonValues = [
  'no-capability',
  'adapter-unresolved',
] as const;
export type OrderWritebackUnsupportedReason =
  (typeof OrderWritebackUnsupportedReasonValues)[number];

export interface OrderLifecycleRelayTargetResult {
  connectionId: string;
  outcome: OrderWritebackOutcome;
  detail?: string;
  /** Present iff `outcome === 'unsupported'`. See the reason type's docs. */
  unsupportedReason?: OrderWritebackUnsupportedReason;
}

export interface OrderLifecycleRelayResult {
  targets: OrderLifecycleRelayTargetResult[];
}

export interface IOrderLifecycleRelayService {
  relay(input: OrderLifecycleRelayInput): Promise<OrderLifecycleRelayResult>;
}
