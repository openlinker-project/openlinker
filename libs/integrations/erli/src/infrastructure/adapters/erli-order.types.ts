/**
 * Erli Order Resource Wire Types
 *
 * Read shapes for Erli's order resource (the JSON `ErliOrderSourceAdapter`
 * (#993) fetches via `GET /orders/{id}` — and the inbox `payload` carries the
 * same shape — and feeds into the #994 mapper).
 *
 * Verified against the live Erli Shop API (#992 spike): money is an INTEGER in
 * minor units (grosze, PLN-only — no currency field); the buyer is `user`
 * (`{ email, deliveryAddress, invoiceAddress }`) with NO buyer id; line items
 * are `items` (not `lineItems`); COD is the `delivery.cod` boolean; the status
 * enum is `pending | purchased | cancelled | returned`; address fields are
 * `zip`/`country`/`buildingNumber`/`flatNumber` (no `postalCode`/`countryCode`/
 * `region`). This file is the SINGLE reconciliation point for the order
 * resource — the mapper imports wire shapes only from here.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */

/**
 * Erli order status (#992). COD orders arrive already `purchased` (committed,
 * paid-on-delivery); the online flow may sit `pending` until payment settles.
 * `returned` is a terminal post-fulfilment state. Unknown/absent falls back to
 * `pending` in the mapper.
 */
export type ErliOrderStatus = 'pending' | 'purchased' | 'cancelled' | 'returned';

/**
 * Erli order address (#992). Polish-format structured fields. `address` is the
 * full formatted street line; `street`/`buildingNumber`/`flatNumber` are its
 * structured parts. `invoiceAddress` additionally carries `type`/`nip`.
 */
export interface ErliOrderAddress {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  /** Full formatted street line (e.g. "ul. Przykładowa 5/3"). */
  address?: string;
  street?: string;
  buildingNumber?: string;
  flatNumber?: string;
  zip?: string;
  city?: string;
  /** ISO country (e.g. "PL"). */
  country?: string;
  phone?: string;
  /** invoiceAddress only — VAT id. */
  nip?: string;
}

/**
 * Erli buyer (#992). `user.email` is the identity key — there is NO buyer id
 * field, so identity resolution (#995) keys on email (email_fallback mode).
 */
export interface ErliOrderUser {
  email: string;
  deliveryAddress?: ErliOrderAddress;
  invoiceAddress?: ErliOrderAddress;
}

/**
 * Erli order line item (#992). Money fields (`unitPrice`,
 * `unitPriceBeforeRebate`) are INTEGER minor units (grosze). `externalId` is the
 * seller-keyed product id the buyer bought (the id OL set on create).
 */
export interface ErliOrderItem {
  id: number;
  externalId: string;
  quantity: number;
  weight?: number;
  /** INTEGER minor units (grosze). */
  unitPrice: number;
  /** INTEGER minor units (grosze). */
  unitPriceBeforeRebate?: number;
  name: string;
  slug?: string;
  ean?: string;
  sku?: string;
  taxRate?: string;
}

/** Erli pickup place reference (#992); present for pickup-point deliveries. */
export interface ErliOrderPickupPlace {
  id?: number;
  externalId?: string;
  type?: string;
  provider?: string;
  name?: string;
  address?: string;
  city?: string;
  country?: string;
  zip?: string;
}

/**
 * Erli delivery (#992). `cod` is the cash-on-delivery boolean (NOT a payment-
 * method string); `price` is INTEGER minor units (grosze).
 */
export interface ErliOrderDelivery {
  name?: string;
  typeId?: string;
  /** INTEGER minor units (grosze). */
  price?: number;
  cancelled?: number;
  cod: boolean;
  sourceMarket?: string;
  targetMarket?: string;
  pickupPlace?: ErliOrderPickupPlace;
}

/**
 * Erli order resource — the shape `getOrder` (#993) reads, and the inbox
 * `payload` carries (#992). Only the fields the #994 mapper consumes are
 * modelled; the resource carries more (rebate, payment, returns,
 * deliveryTracking, calculatedParcelsCount, cursor).
 */
export interface ErliOrder {
  /** Erli-native order id (the id `GET /orders/{id}` is keyed by). */
  id: string;
  /** Seller-side external order reference (optional). */
  externalOrderId?: string;
  status: ErliOrderStatus;
  user: ErliOrderUser;
  items: ErliOrderItem[];
  delivery: ErliOrderDelivery;
  /** Order grand total in INTEGER minor units (grosze). */
  totalPrice: number;
  comment?: string;
  /** Status in the seller's own system (informational). */
  sellerStatus?: string;
  /** ISO-ish timestamps; created/updated fall back to ingestion time. */
  created?: string;
  updated?: string;
  /** When the buyer placed the order on Erli; omitted when absent. */
  purchasedAt?: string;
}
