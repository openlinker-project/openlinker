/**
 * Erli Fulfillment Writeback Wire Types (#997)
 *
 * Provisional write shapes for pushing OL's fulfilment lifecycle BACK to Erli —
 * the status writeback + tracking attach the `ErliOrderSourceAdapter`'s
 * `OrderDispatchNotifier.notifyDispatched` issues (Half A of #997). Models the
 * status-update endpoint path/verb, the OL→Erli reverse status vocabulary
 * (reverse of the #994 ingest mapper), and the dispatch/tracking payload body.
 *
 * #992-PROVISIONAL — grep token shared with the webhook types file so a future
 * sandbox-spike sweep for `#992-PROVISIONAL` catches every unconfirmed wire file.
 *
 * PROVISIONAL (#992): Erli's status-update endpoint, HTTP verb, the exact
 * "dispatched/sent" status token (the ingest set `pending|purchased|cancelled`
 * carries NO confirmed sent value — Q-992-2), and the tracking field names are
 * all UNCONFIRMED until the sandbox spike. This file is the SINGLE
 * reconciliation point for every fulfillment-writeback wire assumption — the
 * adapter imports the writeback path builder, the status token, and the payload
 * type only from here, so #992 updates exactly one place (same discipline as
 * `erli-order.types.ts` / `erli-inbox.types.ts` / `erli-product.types.ts`).
 *
 * Path hygiene: the writeback path interpolates the Erli-issued external order
 * id via `erliFulfillmentPath`, which is `encodeURIComponent`-ONLY — NOT the
 * fail-closed regex allowlist `ErliOfferManagerAdapter.productPath` uses. The
 * order id is Erli-issued (opaque, not operator-controlled), so encoding alone
 * blocks path-traversal/injection; the allowlist (keyed on an `ol_variant_*`
 * offer id) belongs to the Half-B stock-restore path, not here.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */

/**
 * Provisional Erli fulfillment writeback status vocabulary (#992 / Q-992-2).
 * The ingest set (`erli-order.types.ts`) is `pending | purchased | cancelled`
 * and carries NO confirmed "shipped/sent" token, so the writeback token is
 * assumed distinct and pinned here. If the spike confirms Erli has no
 * sent-status writeback at all, Half A degrades to tracking-attach-only — a
 * single-token change in this file.
 */
export type ErliFulfillmentStatus = 'dispatched';

/** Erli "dispatched/sent" writeback token (#992 / Q-992-2). */
export const ERLI_FULFILLMENT_STATUS_DISPATCHED: ErliFulfillmentStatus = 'dispatched';

/**
 * OL order lifecycle → Erli writeback action (#997).
 *
 * Reverse of the #994 ingest `mapStatus` (`erli-order.mapper.ts:93-104`). Only
 * the `dispatched` push is wire-bearing here; the other lifecycle outcomes carry
 * NO status push:
 *   - `processing` (Erli already `purchased`)  → no push (nothing to write).
 *   - `shipped` / dispatched                    → push `dispatched` + tracking
 *                                                  attach when a waybill is present.
 *   - `delivered`                               → no push (v1 carries no status
 *                                                  arg beyond "dispatched").
 *   - `cancelled`                               → no status push; the action is
 *                                                  the Half-B stock-restore
 *                                                  compensating write (Erli already
 *                                                  knows it cancelled — it cancelled it).
 *   - `refunded` / `returned`                   → out of scope (no v1 refund signal).
 *
 * Kept as documentation + the one shipping token rather than a redundant map
 * value-set — the only lifecycle outcome that produces a writeback request is
 * `dispatched`, which `notifyDispatched` owns.
 */
export const ERLI_OL_TO_FULFILLMENT_STATUS = {
  dispatched: ERLI_FULFILLMENT_STATUS_DISPATCHED,
} as const;

/**
 * Provisional Erli fulfillment-status update body (#992 / Q-992-1, Q-992-2).
 * Carries the writeback status token; tracking rides on the separate
 * {@link ErliFulfillmentTrackingBody} attach (mirrors Allegro's split between
 * `PUT …/fulfillment {status}` and `POST …/shipments {waybill}`).
 */
export interface ErliFulfillmentStatusBody {
  status: ErliFulfillmentStatus;
}

/**
 * Provisional Erli tracking-attach body (#992 / Q-992-3). Sent ONLY when OL
 * holds a real waybill (a non-Erli carrier — see the omit-on-absence rule in
 * `notifyDispatched`). `carrier` is the neutral carrier-hint platformType passed
 * through verbatim; #992 may rename these fields or fold them into the status
 * body — the single change point is here.
 */
export interface ErliFulfillmentTrackingBody {
  trackingNumber: string;
  carrier?: string;
}

/** Provisional Erli fulfillment status-update endpoint sub-path (#992 / Q-992-1). */
export const ERLI_FULFILLMENT_PATH_SUFFIX = 'fulfillment';
/** Provisional Erli tracking-attach endpoint sub-path (#992 / Q-992-1, Q-992-3). */
export const ERLI_FULFILLMENT_SHIPMENTS_SUFFIX = 'shipments';

/**
 * Builds the Erli fulfillment-status writeback path (`…/orders/{id}/fulfillment`).
 * `encodeURIComponent`-ONLY (see file header): the order id is Erli-issued and
 * opaque, so encoding blocks path-traversal/injection without the offer-path
 * regex allowlist. Reuses the `/orders` base from `erli-inbox.types.ts` by
 * mirroring its `erliOrderPath` encode discipline.
 */
export function erliFulfillmentPath(externalOrderId: string): string {
  return `/orders/${encodeURIComponent(externalOrderId)}/${ERLI_FULFILLMENT_PATH_SUFFIX}`;
}

/**
 * Builds the Erli tracking-attach path (`…/orders/{id}/shipments`).
 * `encodeURIComponent`-ONLY, same rationale as {@link erliFulfillmentPath}.
 */
export function erliFulfillmentShipmentsPath(externalOrderId: string): string {
  return `/orders/${encodeURIComponent(externalOrderId)}/${ERLI_FULFILLMENT_SHIPMENTS_SUFFIX}`;
}
