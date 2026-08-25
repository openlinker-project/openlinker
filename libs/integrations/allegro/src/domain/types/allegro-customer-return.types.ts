/**
 * Allegro Customer Return Wire Types
 *
 * The `CustomerReturn` shapes as Allegro's OpenAPI spec declares them
 * (`GET /order/customer-returns`, `GET /order/customer-returns/{id}`, both
 * `[BETA]`), plus the one derived constant the adapter publishes to core.
 *
 * Verified against `https://developer.allegro.pl/swagger.yaml` (schemas
 * `CustomerReturnResponse` / `CustomerReturn` / `CustomerReturnItem` /
 * `CustomerReturnItemReason` / `Price`) rather than transcribed from the spike
 * sketch, which left `items[].price` untyped. It is `Price`, and its `amount`
 * is a **string** — Allegro's own note says "provided in a string format to
 * avoid rounding errors" — so any consumer wanting a number must parse it and
 * decide what an unparseable value means. See the mapper.
 *
 * **`[BETA]` media type.** Both endpoints serve
 * `application/vnd.allegro.beta.v1+json`, not the `public.v1` default every
 * other Allegro call uses. It may change without the usual deprecation ladder
 * (SPIKE-2289 risk 7), so nothing here should be treated as frozen.
 *
 * @module libs/integrations/allegro/src/domain/types
 * @see docs/plans/analysis/SPIKE-2289-allegro-returns-feed.md
 */

/** The `[BETA]` media type both customer-return endpoints require. */
export const ALLEGRO_CUSTOMER_RETURN_MEDIA_TYPE = 'application/vnd.allegro.beta.v1+json';

/**
 * The source statuses that mean "this return is finished", and therefore the
 * ones the pass-2 sweep may stop re-reading.
 *
 * **ONE constant, two consumers, and that is the point.** It feeds both the
 * adapter's `terminalRawStatuses` declaration (which core applies as an opaque
 * SQL exclusion) and its per-observation `isTerminalAtSource` hint. Deriving
 * those independently is exactly the drift that produces a return excluded from
 * the sweep while still reported as open — invisible, and permanent. A spec
 * asserts the two agree.
 *
 * Of Allegro's eleven statuses, four are terminal:
 *  - `FINISHED` — refunded, process complete.
 *  - `FINISHED_APT` — refunded by Allegro Protect, process complete.
 *  - `REJECTED` — the seller refused the refund; nothing further happens.
 *  - `COMMISSION_REFUNDED` — the commission rebate settled.
 *
 * Three near-misses are deliberately NOT terminal, and each for a reason:
 *  - `DELIVERED` — the parcel arrived; the MONEY has not moved. This is the
 *    status a return sits in while the seller decides, which is precisely when
 *    OL most needs to keep watching.
 *  - `WAREHOUSE_DELIVERED` — the same, in Allegro's own warehouse.
 *  - `COMMISSION_REFUND_CLAIMED` — a claim was filed, not settled; the
 *    settlement is a later transition and would be missed.
 *
 * Terminal here means only "stop asking the source". It is never an OL
 * disposition — see `IncomingReturn.isTerminalAtSource`.
 */
export const ALLEGRO_CUSTOMER_RETURN_TERMINAL_STATUSES = [
  'FINISHED',
  'FINISHED_APT',
  'REJECTED',
  'COMMISSION_REFUNDED',
] as const;

export type AllegroCustomerReturnTerminalStatus =
  (typeof ALLEGRO_CUSTOMER_RETURN_TERMINAL_STATUSES)[number];

/**
 * Allegro's `Price` — note `amount` is a STRING, by their design.
 */
export interface AllegroPriceWire {
  amount: string;
  currency: string;
}

export interface AllegroCustomerReturnItemReasonWire {
  /**
   * Open-world by construction: the spec documents this as prose, NOT an
   * OpenAPI `enum`, and Allegro has extended the list since the resource
   * shipped (SPIKE-2289 E13). Modelled as a bare `string` and passed through
   * verbatim — a closed union here would silently drop a reason the day it was
   * added.
   */
  type?: string;
  /**
   * The buyer's free-text comment. Carried in the wire type because it exists,
   * and deliberately NOT merged into the neutral `reasonRaw` — it is buyer prose
   * (i.e. PII-adjacent) and concatenating it into a field core maps onto a
   * reason vocabulary would corrupt that mapping for every return whose buyer
   * typed something.
   */
  userComment?: string;
}

export interface AllegroCustomerReturnItemWire {
  offerId?: string;
  quantity?: number;
  name?: string;
  price?: AllegroPriceWire;
  url?: string;
  reason?: AllegroCustomerReturnItemReasonWire;
  serialNumbers?: string[];
}

export interface AllegroCustomerReturnBuyerWire {
  email?: string;
  login?: string;
}

/**
 * The aggregate. Note what is NOT here in any useful sense: an `updatedAt`.
 * `createdAt` is the only timestamp on the resource, which is the single fact
 * that forces returns ingestion to be two passes rather than one.
 */
export interface AllegroCustomerReturnWire {
  id?: string;
  orderId?: string;
  referenceNumber?: string;
  createdAt?: string;
  status?: string;
  isFulfillment?: boolean;
  marketplaceId?: string;
  buyer?: AllegroCustomerReturnBuyerWire;
  items?: AllegroCustomerReturnItemWire[];
  /** Present only for COD / transfer / Allegro Pay. Not projected — rides raw. */
  refund?: unknown;
  /** Parcel/waybill detail. Not projected — rides raw. */
  parcels?: unknown[];
  /**
   * The seller's refusal, if any.
   *
   * Typed since #2333 (it was `unknown`) because `rejection.createdAt` is the
   * AUTHORITATIVE decline instant — the value core stamps onto
   * `ReturnRecord.declinedAt`. Not projected into `IncomingReturn`; it rides
   * `raw` for ingestion and is read directly by the decline write.
   */
  rejection?: AllegroCustomerReturnRejectionWire;
}

/**
 * `GET /order/customer-returns` envelope.
 *
 * `count` is declared but its semantics are unstated — total matching, or page
 * size? (SPIKE-2289 risk 8.) It is therefore read as debug information only:
 * termination is an empty `customerReturns` array, never a count comparison,
 * because a consumer that guessed wrong would either stop early (losing returns
 * silently) or loop forever.
 */
export interface AllegroCustomerReturnsResponse {
  count?: number;
  customerReturns?: AllegroCustomerReturnWire[];
}

/**
 * `CustomerReturnRejection` — the seller's refusal as Allegro reports it.
 *
 * Verified against `https://developer.allegro.pl/swagger.yaml`
 * (`CustomerReturnRejection`, `CustomerReturnRefundRejectionRequest`) rather
 * than transcribed from the spike sketch.
 *
 * Every field is optional in the spec, including `createdAt` — so the decline
 * write must treat a missing instant as "the source has not reported the
 * decline as a fact" rather than substituting its own clock.
 */
export interface AllegroCustomerReturnRejectionWire {
  code?: string;
  reason?: string;
  createdAt?: string;
}

/**
 * The seven codes `POST /order/customer-returns/{id}/rejection` accepts.
 *
 * Published to core as the adapter's opaque `declineReasonCodes`. Core never
 * interprets a member — the `terminalRawStatuses` contract.
 *
 * The list is a closed OpenAPI `enum` (unlike `items[].reason.type`, which is
 * prose and open-world), so validating against it before the call is safe and
 * saves a round trip that Allegro would answer with a 400.
 */
export const ALLEGRO_RETURN_REJECTION_CODES = [
  'REFUND_REJECTED',
  'NEW_ITEM_SENT',
  'ITEM_FIXED',
  'MISSING_PART_SENT',
  'ITEM_MISMATCH',
  'BUSINESS_PURCHASE',
  'NO_RETURN_RIGHT',
] as const;

export type AllegroReturnRejectionCode =
  (typeof ALLEGRO_RETURN_REJECTION_CODES)[number];

/**
 * The one code for which Allegro requires a free-text `reason` (spec:
 * "required when code is REFUND_REJECTED"), and that field's declared length
 * cap.
 *
 * Both are enforced adapter-side, before the call: the platform states the rule,
 * so mirroring it here turns a 400 into an immediate, explainable refusal —
 * and core must never learn either constant.
 */
export const ALLEGRO_RETURN_REJECTION_REASON_REQUIRED_FOR = 'REFUND_REJECTED';
export const ALLEGRO_RETURN_REJECTION_REASON_MAX_LENGTH = 250;
