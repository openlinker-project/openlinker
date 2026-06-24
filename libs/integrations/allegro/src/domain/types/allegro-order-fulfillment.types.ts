/**
 * Allegro Order-Side Fulfillment Wire Types (#837)
 *
 * Shapes for marking an Allegro order sent + attaching a waybill, via
 * `PUT /order/checkout-forms/{id}/fulfillment` and
 * `POST /order/checkout-forms/{id}/shipments`. Verified against the Allegro
 * orders tutorial; the enum spelling, carrier vocabulary, and `OTHER` rules are
 * doc-derived — each isolated to a named constant so a sandbox correction is a
 * one-line edit (`needs-sandbox-probe`, #837).
 *
 * @module libs/integrations/allegro/src/domain/types
 */

/** Fulfillment status set on mark-sent. `needs-sandbox-probe`: enum spelling. */
export const ALLEGRO_FULFILLMENT_STATUS_SENT = 'SENT';

/**
 * Fulfillment status set when OL relays an order cancellation to Allegro
 * (#1159). Verified present in Allegro's fulfillment-status enum (set via the
 * same `PUT /order/checkout-forms/{id}/fulfillment` endpoint). This is the
 * seller-side handling signal only — it issues no refund (OL is never the money
 * book of record, ADR-027). `needs-sandbox-probe`: post-SENT transition rules.
 */
export const ALLEGRO_FULFILLMENT_STATUS_CANCELLED = 'CANCELLED';

export interface AllegroSetFulfillmentRequest {
  status: string;
}

export interface AllegroAttachShipmentRequest {
  carrierId: string;
  waybill: string;
  /** Required by Allegro only when `carrierId === 'OTHER'`. */
  carrierName?: string;
}

/** Allegro's catch-all carrier id (from the fixed `GET /order/carriers` vocab). */
export const ALLEGRO_OTHER_CARRIER_ID = 'OTHER';

/**
 * Static map: OL shipping-processor `platformType` → Allegro `carrierId`.
 * Anything not listed falls back to `OTHER` + a `carrierName`. The carrier ids
 * are doc-derived from `GET /order/carriers` (`needs-sandbox-probe`); a dynamic
 * carriers lookup is a later refinement (#837 Q5).
 */
export const ALLEGRO_CARRIER_BY_PLATFORM_TYPE: Readonly<Record<string, string>> = {
  inpost: 'INPOST',
  dpd: 'DPD',
  dhl: 'DHL',
};
