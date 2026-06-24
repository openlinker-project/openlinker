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

export const OrderLifecycleEventTypeValues = ['dispatched', 'cancelled'] as const;
export type OrderLifecycleEventType = (typeof OrderLifecycleEventTypeValues)[number];

/**
 * A lifecycle event targeted at a single participant. `externalOrderId` is the
 * participant's own external order id, resolved upstream by the relay (the
 * adapter performs no identifier mapping).
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
