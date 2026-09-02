/**
 * Phase → OrderStatus projection (#2305, ADR-059)
 *
 * The **one-way** mapping from the derived `OrderLifecyclePhase` onto the
 * transport vocabulary `OrderStatus`. ADR-059's Decision makes the direction
 * explicit and it is the whole contract of this file: `OrderStatus` stays the
 * transport vocabulary for `OrderCreate` / `OrderFulfillmentUpdater`; the phase
 * projects one way onto it for writeback and **never reads back from it**.
 * `order_state_mappings` — the operator-configured destination status
 * translation — is transport-layer translation and never feeds the derivation.
 *
 * Reading back would close a loop that destroys the model: the phase is derived
 * from facts, and a status derived from the phase then feeding a fact would
 * make the phase depend on its own output.
 *
 * **Totality is enforced at compile time** by the `Record<OrderLifecyclePhase,
 * OrderStatus>` annotation — adding a tenth phase is a type error here, not a
 * silent `undefined` handed to a writeback adapter. A spec additionally asserts
 * it at runtime by iterating `OrderLifecyclePhaseValues`.
 *
 * **The per-phase targets are an implementation choice, not an ADR mandate.**
 * ADR-059 names the mapping and its direction; which of the six statuses each
 * phase lands on is decided here, so each line carries its own rationale and
 * the whole table is reviewer-visible. `OrderStatus` is coarser than the phase
 * (six values vs nine), so the projection is deliberately lossy — several
 * phases collapse onto `processing`, which is correct: they are all "OL has the
 * order, it has not shipped, it is not cancelled", and that is precisely as
 * much as the transport vocabulary can say.
 *
 * @module libs/core/src/order-lifecycle/domain/domain-services
 * @see docs/architecture/adrs/059-order-lifecycle-derived-phase.md
 */
import type { OrderStatus } from '@openlinker/core/orders/types';

import type { OrderLifecyclePhase } from '../types/order-lifecycle-phase.types';

/**
 * The projection table. One line per phase, each with its reason.
 */
const ORDER_STATUS_BY_PHASE: Record<OrderLifecyclePhase, OrderStatus> = {
  /** Exact counterpart: `cancelled` exists in both vocabularies and means the same thing. */
  cancelled: 'cancelled',
  /**
   * Posture B — the vendor reported a label OL cannot classify. OL will not
   * guess a transport status from an unclassifiable string, and `processing`
   * is the only honest reading: OL holds the order and cannot claim it shipped,
   * delivered or cancelled.
   */
  vendor_authoritative: 'processing',
  /** Exact counterpart: a terminal delivered observation maps to `delivered`. */
  delivered: 'delivered',
  /** `shipped` is the transport vocabulary's name for "in the carrier's hands". */
  in_transit: 'shipped',
  /**
   * Fulfilment was attempted and failed. `OrderStatus` has no failure value —
   * `refunded` would assert a financial event that has not happened, and
   * `cancelled` would assert a decision nobody made — so the order remains
   * `processing`, which is true: it is still OL's to resolve.
   */
  fulfillment_failed: 'processing',
  /** A hold is an internal pause; the order is still in progress downstream. */
  held: 'processing',
  /** An amendment in flight does not change what the destination should believe. */
  amending: 'processing',
  /**
   * `blocked` describes OL's OWN incompleteness (an ingest gap), not anything
   * the destination can act on — so it must not leak as a distinct status.
   */
  blocked: 'processing',
  /**
   * Residual: nothing has happened to it yet. `pending` is the one status that
   * says "received, not yet worked", which is exactly `ready`'s meaning.
   */
  ready: 'pending',
};

/**
 * Project a derived phase onto the transport status. Pure and total.
 */
export function phaseToOrderStatus(phase: OrderLifecyclePhase): OrderStatus {
  return ORDER_STATUS_BY_PHASE[phase];
}
