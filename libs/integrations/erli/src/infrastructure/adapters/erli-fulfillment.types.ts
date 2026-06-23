/**
 * Erli Fulfillment Writeback Wire Types (#997)
 *
 * Write shapes for pushing OL's fulfilment lifecycle BACK to Erli — the status
 * writeback + external-shipment registration the `ErliOrderSourceAdapter`'s
 * `OrderStatusWriteback.write` issues for a `dispatched` lifecycle event.
 *
 * #992-PROVISIONAL — these wire shapes are NOT yet confirmed against the Erli
 * sandbox; they mirror the DOCUMENTED API and are why the writeback path ships
 * default-OFF (`OL_ERLI_DISPATCH_WRITEBACK_ENABLED`). Confirm via the #992 spike
 * before enabling in production:
 *  - Dispatch is `PATCH /orders/{id}/status { status: 'sent' }` — the order
 *    status enum (`pending | purchased | cancelled | returned`) has no
 *    `dispatched`; `sent` is the dispatch state.
 *  - Tracking is registered via `POST /shipping/external`, whose body is an
 *    ARRAY of `{ vendor, orderId, trackingNumber? }` (`vendor` + `orderId`
 *    required) — NOT a per-order `…/shipments` sub-resource.
 *
 * This file is the SINGLE reconciliation point for fulfillment-writeback wire
 * assumptions — the adapter imports the path builder, the status token, and the
 * payload types only from here. A #992 revision updates this one file.
 *
 * Path hygiene: `erliOrderStatusPath` interpolates the Erli-issued external
 * order id via `encodeURIComponent` ONLY — the order id is Erli-issued (opaque,
 * not operator-controlled), so encoding blocks path-traversal/injection without
 * the `ol_variant_*` regex allowlist the offer path uses.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */

/**
 * Erli order dispatch status token. The order status enum carries `sent` as the
 * dispatch state (there is no `dispatched`). Reverse of the #994 ingest mapper.
 */
export type ErliOrderStatusWriteback = 'sent';

/** Erli "dispatched" writeback token — the order-status enum's `sent` value. */
export const ERLI_ORDER_STATUS_SENT: ErliOrderStatusWriteback = 'sent';

/**
 * OL order lifecycle → Erli writeback action (#997). Only the dispatch push is
 * wire-bearing: `shipped`/dispatched → `PATCH /orders/{id}/status {status:'sent'}`
 * + external-shipment registration when a waybill is present. `processing`
 * (Erli already `purchased`), `delivered`, `cancelled` (Half-B stock-restore,
 * not a status push), and `refunded`/`returned` carry no status push in v1.
 */
export const ERLI_OL_TO_ORDER_STATUS = {
  dispatched: ERLI_ORDER_STATUS_SENT,
} as const;

/** Body for `PATCH /orders/{id}/status` (#992): the order status token. */
export interface ErliOrderStatusBody {
  status: ErliOrderStatusWriteback;
}

/**
 * One entry in the `POST /shipping/external` array body (#992). `vendor` (the
 * carrier) and `orderId` are required; `trackingNumber` rides when OL holds a
 * waybill. `vendor` is the neutral carrier-hint platformType passed verbatim
 * (e.g. `inpost`, `dpd`).
 */
export interface ErliExternalShipmentBody {
  vendor: string;
  orderId: string;
  trackingNumber?: string;
}

/** Builds the Erli order-status writeback path (`/orders/{id}/status`). */
export function erliOrderStatusPath(externalOrderId: string): string {
  return `/orders/${encodeURIComponent(externalOrderId)}/status`;
}

/** Erli external-shipment registration endpoint (#992). Body is an ARRAY of entries. */
export const ERLI_EXTERNAL_SHIPPING_PATH = '/shipping/external';
