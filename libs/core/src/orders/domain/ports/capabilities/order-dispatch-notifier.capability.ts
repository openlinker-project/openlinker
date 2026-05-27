/**
 * Order Dispatch Notifier Capability
 *
 * Optional sub-capability of `OrderSourcePort` (#837) — order *sources* that can
 * be told an order's items have been dispatched declare `implements
 * OrderDispatchNotifier`. The source marks the order sent (so the buyer sees
 * tracking) and, when a waybill is supplied, attaches it.
 *
 * This is the generic "step 5 — mark sent on the source" capability from the
 * #732 spec. It is **not** Allegro-specific: any marketplace source that
 * supports a mark-shipped + push-tracking write implements it. Allegro maps it
 * to `PUT /order/checkout-forms/{id}/fulfillment {status:SENT}` plus, when a
 * waybill is present, `POST /order/checkout-forms/{id}/shipments`.
 *
 * Call sites resolve the source adapter via
 * `getCapabilityAdapter<OrderSourcePort>(sourceConnectionId, 'OrderSource')`
 * then narrow with `isOrderDispatchNotifier` before invoking, degrading
 * gracefully (skip) when the source doesn't implement it.
 *
 * Forward-compat: v1 carries no status argument — the sole intent is
 * "dispatched / sent". A future "notify delivered to the source" would add a
 * typed status field here rather than a new method.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see {@link OrderSourcePort} for the base port
 */
import type { DispatchCarrierHint } from '../../types/dispatch-carrier-hint.types';
import type { OrderSourcePort } from '../order-source.port';

export interface OrderDispatchNotifier {
  /**
   * Notify the order source that the order's items have been dispatched.
   *
   * - Always marks the order "sent" on the source.
   * - `trackingNumber` present ⇒ also attach the waybill (the source-brokered
   *   branch omits it — the source already holds the waybill it issued).
   * - `carrier` hints which carrier produced the waybill; the adapter maps it
   *   to its own carrier vocabulary.
   *
   * `externalOrderId` is resolved upstream by the orchestration (the source's
   * external order id), so the adapter performs no identifier mapping.
   */
  notifyDispatched(input: {
    externalOrderId: string;
    trackingNumber?: string;
    carrier?: DispatchCarrierHint;
  }): Promise<void>;
}

export function isOrderDispatchNotifier(
  adapter: OrderSourcePort,
): adapter is OrderSourcePort & OrderDispatchNotifier {
  return typeof (adapter as Partial<OrderDispatchNotifier>).notifyDispatched === 'function';
}
