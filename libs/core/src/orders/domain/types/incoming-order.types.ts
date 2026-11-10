/**
 * Incoming Order Types
 *
 * Integration-facing order DTO returned by OrderSourcePort adapters (marketplaces + shops).
 * This is intentionally decoupled from canonical persistence/domain entities so that
 * the plugin contract can remain stable even as core evolves.
 *
 * Domain-only: no framework dependencies.
 *
 * @module libs/core/src/orders/domain/types
 */

import type {
  OrderShipping,
  OrderPickupPoint,
  OrderDispatchWindow,
  PriceTaxTreatment,
} from './order.types';
import type { PaymentMethod } from './payment-method.types';
import type { PaymentStatus } from './payment-status.types';
import type { CodToCollect } from './cod-to-collect.types';

export interface IncomingOrder {
  /**
   * Marketplace-native order identifier.
   */
  externalOrderId: string;

  /**
   * Optional human-readable order number (if marketplace provides it).
   */
  orderNumber?: string;

  /**
   * Optional deep link to this order in the source platform's own UI
   * (marketplace seller panel / shop admin) (#1713). Built by the source
   * adapter — the only layer that knows the platform's URL scheme and its
   * per-connection base URL / environment. Absent when the source can't build
   * a stable URL; core persists it verbatim onto the snapshot and the FE
   * renders a link only when present.
   */
  externalUrl?: string;

  /**
   * Status as provided/mapped by adapter.
   */
  status: string;

  /**
   * Optional customer identifier as provided by the source (external-only).
   *
   * Core may choose to resolve this to an internal customer ID during ingestion,
   * but adapters MUST NOT emit internal OpenLinker IDs here.
   */
  customerExternalId?: string;

  /**
   * Optional buyer email from source platform.
   *
   * Used by core to create/update customer projections and enable email-fallback
   * identity resolution. Adapters should populate this when available.
   */
  customerEmail?: string;

  items: IncomingOrderItem[];
  totals: IncomingOrderTotals;

  shippingAddress?: IncomingOrderAddress;
  billingAddress?: IncomingOrderAddress;

  /**
   * Source-side shipping reference (e.g. Allegro `delivery.method`). Optional —
   * order sources that don't expose a delivery-method id leave it undefined.
   * Carrier resolution at the destination adapter consumes `methodId`.
   */
  shipping?: OrderShipping;

  /**
   * Pickup-point reference (Allegro `delivery.pickupPoint`, InPost-style locker).
   * Present only for pickup-point orders; locker geography lives on `shippingAddress`,
   * the structured id+labels live here.
   */
  pickupPoint?: OrderPickupPoint;

  /**
   * Allegro Smart! free-delivery flag (`delivery.smart` on the checkout-form
   * response). Informational only — no business logic depends on it in v1;
   * future surfaces (filtering, analytics, badges) read this signal. Absent
   * (`undefined`) for non-Allegro sources and for Allegro orders predating
   * the Smart! program.
   */
  deliverySmart?: boolean;
  /**
   * The source asserts that IT (the marketplace) ships this order itself, e.g.
   * Allegro One Fulfillment (#3636). Three-state like `buyerTaxId` (#2599):
   * `true` is a positive statement; ABSENT means "not asserted" and must never
   * be read as "the seller ships" - a source that cannot tell leaves it unset.
   * Typed `true` on purpose: there is no `false` a source needs to send, so a
   * source that cannot tell leaves the field unset.
   */
  fulfilledBySource?: true;
  /** Source-reported payment status (#928); absent when the source did not report it. */
  paymentStatus?: PaymentStatus;
  /**
   * How the buyer pays (#3294), mapped onto the closed neutral vocabulary by the
   * source adapter. Absent when the source did not report it; an adapter that
   * cannot map its native value with evidence reports `'unknown'` - never a
   * guess. Orthogonal to `paymentStatus`.
   */
  paymentMethod?: PaymentMethod;
  /**
   * The buyer's checkout message to the seller (#3538). Three states, like
   * `buyerTaxId` (#2599): a string is the note verbatim, `null` means the
   * source asserted the buyer left none, absent means the adapter could not
   * read the field - never "no note". Coerce a raw source value with
   * `readSourceBuyerNote`. Free text, so it is PII-gated at persistence.
   */
  buyerNote?: string | null;
  /**
   * The source's own payment-method id (#3474), e.g. Allegro `payment.type`.
   * Opaque: the same vocabulary `SourceOptionsReader.listPaymentMethods`
   * returns, used only as the key of an operator-configured payment mapping.
   * Absent when the source did not report one.
   */
  sourcePaymentMethod?: string;

  /**
   * Marketplace-sourced cash-on-delivery collect amount (#1435). Set by the
   * source adapter only for a cash-on-delivery order (Allegro maps
   * `summary.totalToPay` — the buyer pays the full order total on delivery).
   * Absent for prepaid orders and for sources that don't expose it.
   */
  codToCollect?: CodToCollect;

  /**
   * Marketplace dispatch (ship-by) commitment window (#927). The SLA deadline
   * is `dispatchTime.to`. Neutral concept — the Allegro adapter maps
   * `delivery.time.dispatch` here; absent for sources without a dispatch SLA.
   */
  dispatchTime?: OrderDispatchWindow;

  /**
   * When the buyer placed the order on the source marketplace, as an ISO string
   * (#926). For Allegro this is the earliest `lineItems[].boughtAt`; for
   * PrestaShop it is `date_add`. Distinct from `createdAt`/`updatedAt` (OL
   * ingestion clocks). Optional — adapters omit it when the source has no
   * placed time. Adapters MUST only emit a valid ISO date string here.
   */
  placedAt?: string;

  /**
   * ISO timestamps (strings) to keep DTO stable across runtimes.
   */
  createdAt: string;
  updatedAt: string;

  /**
   * Optional metadata for observability/debugging.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Who decided a line is a gift (bundles/gifts epics, ports-v1 "Type additions").
 * Closed so analytics can group by it; `channel` means the marketplace itself
 * flagged the line, not that OpenLinker inferred it.
 */
export const GiftSourceValues = ['channel', 'cart-rule', 'ol-rule', 'operator'] as const;
export type GiftSource = (typeof GiftSourceValues)[number];

/**
 * Marks an order line as a gift. Presence is the whole claim; absence means an
 * ordinary line.
 */
export interface LineGift {
  source: GiftSource;
  /** Promotion / cart rule id when known; display and analytics only. */
  ruleRef?: string;
  /**
   * How a sales document shows THIS gift (#3938, gifts spec section 8.3 level 1).
   * Absent means "as in settings": the connection, then the OpenLinker default,
   * decide. Carried only; the three-level resolver lives with the document
   * mappers.
   */
  documentForm?: GiftDocumentForm;
  /**
   * The gross unit price, per gift unit in the order's currency, a
   * `custom-price` gift shows at on a document. A decimal string: positive, at
   * most two decimals. Present only together with `documentForm: 'custom-price'`.
   */
  documentUnitPrice?: string;
}

/** The gift forms on a document (gifts spec section 8.2). */
export const GiftDocumentFormValues = [
  'technical-cent',
  'custom-price',
  'priced-in',
  'show-zero',
  'omit',
] as const;
export type GiftDocumentForm = (typeof GiftDocumentFormValues)[number];

export function isGiftDocumentForm(value: unknown): value is GiftDocumentForm {
  return typeof value === 'string' && (GiftDocumentFormValues as readonly string[]).includes(value);
}

/**
 * A `custom-price` amount: positive decimal string, at most two decimals.
 * Same rule as `isGiftUnitPriceAmount` in sales-documents, restated here
 * because this vocabulary file imports no sibling context.
 */
export function isGiftDocumentUnitPrice(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0;
}

/**
 * Narrows an untyped value (a persisted snapshot, a plugin payload) into a
 * {@link LineGift}. Returns `undefined` rather than guessing for any shape or
 * source this build does not recognise, so an unknown value reads as "ordinary
 * line" instead of a fabricated gift.
 */
export function readLineGift(value: unknown): LineGift | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (!(GiftSourceValues as readonly unknown[]).includes(raw.source)) return undefined;
  const gift: LineGift = { source: raw.source as GiftSource };
  if (typeof raw.ruleRef === 'string') gift.ruleRef = raw.ruleRef;
  // An unrecognised form reads as absent ("as in settings"), never as a guess.
  // A `custom-price` without a usable amount cannot be applied: absent too.
  if (isGiftDocumentForm(raw.documentForm)) {
    if (raw.documentForm !== 'custom-price') {
      gift.documentForm = raw.documentForm;
    } else if (isGiftDocumentUnitPrice(raw.documentUnitPrice)) {
      gift.documentForm = raw.documentForm;
      gift.documentUnitPrice = raw.documentUnitPrice;
    }
  }
  return gift;
}

export interface IncomingOrderItem {
  /**
   * Item identifier (adapter-provided).
   */
  id: string;

  /**
   * External-only product reference.
   *
   * Adapters MUST NOT emit internal OpenLinker IDs here.
   * Core resolves this reference to internal IDs (or fails if mapping is missing).
   */
  productRef: IncomingOrderItemRef;

  quantity: number;
  price: number;
  sku?: string;

  /**
   * Gross (tax-inclusive) UNIT price as the SOURCE reported it. See
   * {@link OrderItem.unitPriceGross} for why this exists and why carrying a
   * reported figure is not computing tax. Absent when the source reports none.
   */
  unitPriceGross?: number;

  /**
   * Source-reported display label (e.g. Allegro `lineItem.offer.name`).
   * Optional because not every adapter has it — PrestaShop's order-source
   * doesn't expose a free per-line product name and would need catalog
   * enrichment to populate this.
   */
  name?: string;

  /**
   * Absolute URL to a representative product image when the source provides
   * one. Optional and forward-compatible: today no order-source endpoint we
   * consume returns this (Allegro's checkout-form does not), so it's reserved
   * for future enrichment.
   */
  imageUrl?: string;

  /**
   * The tax rate the CHANNEL reported for this line, as a neutral
   * percent-as-string code (#2054, ADR-063).
   *
   * This is the fallback rung, not the answer: the shop is asked first, and
   * the channel is consulted only when the shop does not know (ADR-063 § 1).
   * A fix applied in the shop then serves every channel, whereas a rate only
   * the marketplace knows is stamped at purchase and cannot be corrected
   * afterwards.
   *
   * Absent means the source did not report one - which is every source until
   * the channel-read child lands. Allegro's `lineItems[].tax` is nullable and
   * OL published offers carry no rate at all; Erli's `items[].taxRate` is a
   * required enum and always does.
   */
  taxRate?: string;

  /** ISO 3166-1 alpha-2 the channel resolved its rate against. Provenance only. */
  taxRateCountry?: string;

  /** Present when the line is a gift. Absent means an ordinary line. */
  gift?: LineGift;

  /**
   * Units of the mapped variant per sold unit (e.g. an Allegro multipack).
   * Absent means 1. A value above 1 on a variant with no bundle definition
   * holds the order, since reserving or shipping one unit would under-deliver.
   */
  packQuantity?: number;
}

/**
 * External-only reference for an incoming order line item.
 *
 * Marketplaces usually reference offers/listings; some sources reference products/variants/SKUs.
 * This union makes the identifier meaning explicit and removes any prefix-based heuristics.
 */
export type IncomingOrderItemRef =
  | { type: 'offer'; externalId: string }
  | { type: 'variant'; externalId: string }
  | { type: 'product'; externalId: string }
  | { type: 'sku'; externalId: string };

export interface IncomingOrderTotals {
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;

  /**
   * How the source expresses tax on its amounts (gross vs net). See
   * {@link OrderTotals.taxTreatment}. Optional — absent when the source does
   * not assert it.
   */
  taxTreatment?: PriceTaxTreatment;

  /**
   * How `total` ALONE expresses tax, when it diverges from `taxTreatment`. See
   * {@link OrderTotals.totalTaxTreatment} (#2829).
   */
  totalTaxTreatment?: PriceTaxTreatment;

  /**
   * Gross shipping as the SOURCE reported it. See
   * {@link OrderTotals.shippingGross}.
   */
  shippingGross?: number;

  /**
   * The VAT rate the SOURCE charged on delivery, as a percent-as-string code
   * (`'23'`, `'8'`, `'0'`; ADR-063 vocabulary). Absent means the source did not
   * report exactly one rate - never `0`. Carried, never computed (ADR-063): it
   * only lets a document state the delivery rate when the basket's items carry
   * none, and an operator `fixed` delivery rate always wins over it.
   */
  shippingTaxRate?: string;
}

export interface IncomingOrderAddress {
  /**
   * Buyer tax identifier as the source reported it (#2599). Three states, and
   * they are not interchangeable: absent = the source asserted nothing, `null`
   * = the source asserted the buyer has none, a string = the id verbatim.
   *
   * Carried unvalidated, and normalised only by trimming surrounding
   * whitespace - no national format is applied here
   * (ADR-026 keeps country specifics in the provider adapter). Read it through
   * `readBuyerTaxId` rather than reaching for the field, so billing-first
   * precedence lives in one place.
   */
  taxId?: string | null;
  firstName?: string;
  lastName?: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
}

