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
import type { DispatchCarrierHint } from '../../domain/types/dispatch-carrier-hint.types';
import type { OrderWritebackOutcome } from '../../domain/types/order-lifecycle-event.types';

/**
 * A lifecycle event to relay, keyed on the internal order. The relay resolves
 * each target participant's own `externalOrderId`, so the caller supplies only
 * the neutral event + its payload.
 */
export interface OrderLifecycleRelayInput {
  internalOrderId: string;
  /** The participant that authored the event — excluded from the targets (self-echo suppression at the participant level). */
  originConnectionId: string;
  event:
    | { type: 'dispatched'; trackingNumber?: string; carrier?: DispatchCarrierHint }
    | { type: 'cancelled'; reason?: string };
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
