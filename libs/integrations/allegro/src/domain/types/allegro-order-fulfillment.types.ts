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

/**
 * Allegro fulfilment statuses that mean the parcel has LEFT the seller (#3365).
 *
 * Two vocabularies are listed together on purpose. The write path sends the
 * English `SENT` (`ALLEGRO_FULFILLMENT_STATUS_SENT`), while Allegro's seller
 * panel documents this same field with Polish values (`WYSLANE`, `ODEBRANE`,
 * ...). Which spelling a READ returns is not established, so both are accepted
 * rather than guessed at - `needs-sandbox-probe`, and the probe is what removes
 * whichever half turns out to be dead.
 *
 * `DO_ODBIORU` (ready for pickup) is deliberately absent: the parcel is at a
 * pickup point but the order is not yet in the buyer's hands, and the flag this
 * feeds means "dispatched", not "available".
 */
export const ALLEGRO_FULFILLMENT_DISPATCHED_STATUSES: readonly string[] = [
  'SENT',
  'WYSLANE',
  'WYSŁANE',
  'PICKED_UP',
  'ODEBRANE',
];

/**
 * Allegro fulfilment statuses that mean the parcel has NOT left the seller.
 *
 * Kept as an explicit list rather than as "everything else" so an unrecognised
 * value can answer `null`. Reading an unknown status as "not dispatched" would
 * tell an operator their parcel never went out on the strength of a word this
 * build has never seen.
 */
export const ALLEGRO_FULFILLMENT_UNDISPATCHED_STATUSES: readonly string[] = [
  'NEW',
  'NOWE',
  'PROCESSING',
  'W_REALIZACJI',
  'READY_FOR_SHIPMENT',
  'DO_WYSLANIA',
  'DO_WYSŁANIA',
  'READY_FOR_PICKUP',
  'DO_ODBIORU',
  'SUSPENDED',
  'WSTRZYMANE',
  'CANCELLED',
  'ANULOWANE',
];

/**
 * `GET /order/checkout-forms/{id}/shipments` response (#3365).
 *
 * VERIFIED LIVE on the sandbox, 2026-09-27, against two orders OpenLinker had
 * itself dispatched: the route answers 200 and returns exactly the waybills
 * `POST .../shipments` attached, each with the carrier id it was sent under.
 *
 * That probe is why this type exists at all. The repository had previously
 * struck down a `GET .../shipments` as an unverified assumption about somebody
 * else's API (`implementation-plan-waybill-relay-on-tracking-backfill.md`),
 * and it was right to: the endpoint was assumed rather than checked. It is
 * checked now, and the recorded evidence is two live waybills read back under
 * `carrierId: "INPOST"`.
 */
export interface AllegroOrderShipmentsResponse {
  shipments?: AllegroOrderShipment[];
}

export interface AllegroOrderShipment {
  /** The tracking number, as the carrier issued it. */
  waybill?: string;
  /** Allegro's own carrier vocabulary (`INPOST`, `DPD`, `OTHER`, ...). */
  carrierId?: string;
  /** Present when the seller sent `OTHER` plus a free-text name. */
  carrierName?: string;
}
