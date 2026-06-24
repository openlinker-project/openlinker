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

export interface OrderLifecycleRelayTargetResult {
  connectionId: string;
  outcome: OrderWritebackOutcome;
  detail?: string;
}

export interface OrderLifecycleRelayResult {
  targets: OrderLifecycleRelayTargetResult[];
}

export interface IOrderLifecycleRelayService {
  relay(input: OrderLifecycleRelayInput): Promise<OrderLifecycleRelayResult>;
}
