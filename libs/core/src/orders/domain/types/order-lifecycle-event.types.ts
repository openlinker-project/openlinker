/**
 * Order Lifecycle Event (event-as-data)
 *
 * The neutral, role/platform-agnostic payload propagated by the Posture-A
 * lifecycle relay (#1157 / ADR-027). A lifecycle fact authored by one
 * authoritative participant (a source marketplace or a destination shop) is
 * forwarded to the order's other participants, each adapter mapping the event
 * onto its own API.
 *
 * Modelled as a discriminated union — the lifecycle *event* is **data**, not a
 * method/capability per event (mirrors the inbound `OrderFeedEventType`
 * discriminator). New events are added as union members; the single
 * `OrderStatusWriteback.write(event)` contract never grows new methods.
 *
 * Whether a given participant can honour a given event is reported via
 * {@link OrderWritebackResult} — never via the type signature (avoids the
 * silent-no-op / LSP trap when, e.g., a marketplace cannot accept a status).
 *
 * @module libs/core/src/orders/domain/types
 * @see {@link OrderStatusWriteback} for the capability that consumes it
 */
import type { DispatchCarrierHint } from './dispatch-carrier-hint.types';

/**
 * `'delivered'` and `'in-progress'` (#3526) join the two founding members.
 *
 * `'delivered'` is fired by `ShipmentStatusSyncService` on the delivered
 * transition of a shipment's own carrier tracking — see that service for the
 * at-most-once reasoning (a status writeback is idempotent on every shipped
 * adapter, unlike the non-idempotent waybill-attach call `dispatched` also
 * carries, so it does not earn a dedicated claim column the way
 * `Shipment.waybillRelayedAt` does).
 *
 * `'in-progress'` (work accepted / picking) is vocabulary-only in this slice
 * — every adapter maps or declines it, but nothing fires it yet. This mirrors
 * the programme's established posture of shipping a seam ahead of its
 * consumer (`fulfillment-progress.service.interface.ts`'s own header states
 * the same thing for its `'picked'` event): the natural future caller is
 * #2400's fulfilment-progress ingestion the day it needs to relay picking
 * status outward, which is a decision for that slice, not this one.
 */
export const OrderLifecycleEventTypeValues = [
  'dispatched',
  'cancelled',
  'delivered',
  'in-progress',
] as const;
export type OrderLifecycleEventType = (typeof OrderLifecycleEventTypeValues)[number];

/**
 * A lifecycle event targeted at a single participant. `externalOrderId` is the
 * participant's own external order id, resolved upstream by the relay (the
 * adapter performs no identifier mapping).
 *
 * **Exhaustiveness discipline (#2286).** Adding a member here is a breaking
 * change for every in-tree consumer, and that is deliberate: each one branches
 * with `switch (event.type)` over a `default:` arm that binds the narrowed value
 * to `never`, so an unhandled member is a **compile** error rather than a
 * runtime fall-through into whichever arm happened to be last. Before #2286 the
 * consumers used two-arm `if/else`, so a third member would have compiled
 * cleanly and been relayed to every participant *as a cancellation*.
 *
 * A new member therefore requires updating, in the same change: the relay
 * (`OrderLifecycleRelayService`) and the four `OrderStatusWriteback` adapters
 * (Allegro, Erli, PrestaShop, WooCommerce). `OrderLifecycleRelayInput.event` is
 * derived from this union rather than restated, so the widening reaches the
 * relay too.
 *
 * **Port-boundary exception (ADR-055 forward-compat).** The adapters' `default:`
 * arms keep the `never` binding for the compile break but still *return*
 * `{ outcome: 'unsupported' }` instead of throwing — an out-of-tree adapter
 * compiled against an older copy of this union must degrade to a surfaced no-op,
 * never take down a relay fan-out. The relay's own default throws (`assertNever`),
 * because a member it cannot map is an in-tree defect, not a third-party one.
 */
export type OrderLifecycleEvent =
  | {
      type: 'dispatched';
      externalOrderId: string;
      trackingNumber?: string;
      carrier?: DispatchCarrierHint;
    }
  | {
      type: 'cancelled';
      externalOrderId: string;
      reason?: string;
    }
  | {
      type: 'delivered';
      externalOrderId: string;
      /** The carrier's own delivery instant, when known — never OL's clock. */
      deliveredAt?: Date;
    }
  | {
      type: 'in-progress';
      externalOrderId: string;
    };

/**
 * Outcome of a single writeback attempt against one participant.
 * - `applied`     — the participant accepted and applied the event.
 * - `unsupported` — the participant cannot express this event (e.g. no cancel
 *   verb); a no-op, surfaced (not silent).
 * - `rejected`    — the participant refused the event (e.g. cancel after the
 *   order already shipped) or the write failed business-side.
 */
export const OrderWritebackOutcomeValues = ['applied', 'unsupported', 'rejected'] as const;
export type OrderWritebackOutcome = (typeof OrderWritebackOutcomeValues)[number];

export interface OrderWritebackResult {
  outcome: OrderWritebackOutcome;
  /** Operator-readable reason — required for `unsupported` / `rejected`. */
  detail?: string;
}
