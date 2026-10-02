/**
 * Shoper API Types
 *
 * Wire shapes the transport reads. Shoper serializes almost every number as a
 * STRING (`"stock": "77"`, `"count": "36"`), with a few real numbers mixed in
 * (`pages`, `page`, `categories: [38]`), so numeric fields here are typed as
 * the string they arrive as and parsed explicitly by the mapper. Only the
 * fields OpenLinker reads are declared; Shoper sends many more.
 *
 * Shapes were captured from a live trial shop (see
 * `docs/plans/implementation-plan-shoper-product-master-read.md`).
 *
 * @module libs/integrations/shoper/src/domain/types
 */

/**
 * Error envelope Shoper returns on 4xx (SPIKE-3638 C3, C4, M6), e.g.
 * `{"error":"unauthorized_client","error_description":"Provided access token is invalid"}`
 * or `{"error":"invalid_request","error_description":"Resource not found"}`.
 */
export interface ShoperErrorBody {
  readonly error?: string;
  readonly error_description?: string;
}

/**
 * Envelope of every collection endpoint. Paging is PAGE-based, not offset-based.
 * `count` is a string, `pages` and `page` are numbers.
 */
export interface ShoperPageEnvelope<T> {
  readonly count: string;
  readonly pages: number;
  readonly page: number;
  readonly list: readonly T[];
}

/** Per-language text of a product. `isdefault` is unreliable (`"0"` on every language). */
export interface ShoperProductTranslation {
  readonly name?: string | null;
  readonly description?: string | null;
  readonly short_description?: string | null;
}

export interface ShoperMainImage {
  readonly unic_name: string;
  readonly extension: string;
}

/**
 * A `product-stocks` row: the real VARIANT grain (SPIKE-3638 M1). Every Shoper
 * product has at least one, with a real `stock_id`.
 */
export interface ShoperStock {
  readonly stock_id: string;
  readonly product_id: string;
  readonly price: string | null;
  readonly stock: string | null;
  readonly weight: string | null;
  readonly active: string | null;
  readonly default: string | null;
  readonly code: string | null;
  readonly ean: string | null;
  /** Variant option values. Shape not live-verified: the trial shop has no multi-variant product. */
  readonly options: readonly unknown[];
}

/** A `products` row. The list endpoint embeds the same shape, `stock` included. */
export interface ShoperProduct {
  readonly product_id: string;
  readonly tax_id: string | null;
  readonly code: string | null;
  readonly ean: string | null;
  readonly category_id: string | null;
  readonly categories: readonly number[];
  readonly translations: Readonly<Record<string, ShoperProductTranslation>>;
  readonly main_image: ShoperMainImage | null;
  readonly stock: ShoperStock | null;
  readonly options: readonly unknown[];
}

/** Per-language text of a category. */
export interface ShoperCategoryTranslation {
  readonly name?: string | null;
  readonly active?: string | null;
}

/** A `GET /categories` row: carries the TEXT, not the structure. */
export interface ShoperCategory {
  readonly category_id: string;
  readonly translations: Readonly<Record<string, ShoperCategoryTranslation>>;
}

/** A `GET /categories-tree` node: carries the STRUCTURE only (ids, no names). */
export interface ShoperCategoryTreeNode {
  readonly id: number;
  readonly children: readonly ShoperCategoryTreeNode[];
}

/**
 * A `GET /taxes` row. Three live rows share `value: "0"` (`0%`, `zw.`, `np.`),
 * so the NAME is what identifies the rate, not `value`.
 */
export interface ShoperTax {
  readonly tax_id: string;
  readonly value: string;
  readonly name: string;
}

/** The slice of `GET /application-config` the adapter reads. */
export interface ShoperApplicationConfig {
  readonly default_language_name: string;
  readonly default_currency_name: string;
  readonly locale_default_weight: string;
  /**
   * Multi-warehouse module (a paid Premium feature, SPIKE-3638 M10). A real JSON
   * boolean on the live shop (`false`). Only an explicit "off" (`false`, `0`,
   * `"0"`, `"false"`) reads as off; anything else - including a missing field -
   * reads as on, so stock is refused rather than published on a guess.
   */
  readonly warehouses_enabled: boolean | string | number;
}

/** A `GET /users` row (the slice the customer provisioner reads). */
export interface ShoperUser {
  readonly user_id: string;
  readonly email: string;
  readonly firstname?: string | null;
  readonly lastname?: string | null;
}

/** Body of `POST /users`. */
export interface ShoperUserCreateRequest {
  readonly email: string;
  readonly firstname: string;
  readonly lastname: string;
  readonly active: 1;
}

/** A `GET /shippings` row (the slice the order flow reads). */
export interface ShoperShipping {
  readonly shipping_id: string;
  /** The shipping method's own tax; becomes the order's `shipping_tax_id`. */
  readonly tax_id: string;
}

/** A `GET /currencies` row. */
export interface ShoperCurrency {
  readonly currency_id: string;
  readonly name: string;
}

/** Billing / delivery address of `POST /orders`. */
export interface ShoperOrderAddress {
  readonly firstname: string;
  readonly lastname: string;
  readonly company: string;
  readonly street1: string;
  readonly street2: string;
  readonly city: string;
  readonly postcode: string;
  readonly state: string;
  readonly country_code: string;
  readonly phone: string;
  readonly tax_identification_number: string;
}

/** Body of `POST /orders` (the six required fields of SPIKE-3638 O1, plus context). */
export interface ShoperOrderCreateRequest {
  readonly user_id: number;
  readonly email: string;
  readonly status_id: number;
  readonly payment_id: number;
  readonly shipping_id: number;
  readonly shipping_tax_id: number;
  readonly shipping_cost: number;
  readonly currency_id: number;
  readonly billing_address: ShoperOrderAddress;
  readonly delivery_address: ShoperOrderAddress;
  /** Private note: the OpenLinker order id, for forensic recovery only (NOT a dedup key). */
  readonly notes_priv?: string;
}

/** Body of `POST /order-products`. `price` is GROSS and `tax` is the tax NAME. */
export interface ShoperOrderProductCreateRequest {
  readonly order_id: number;
  readonly product_id: number;
  readonly stock_id: number;
  readonly price: number;
  readonly quantity: number;
  readonly name: string;
  readonly tax: string;
  readonly tax_value: number;
}

/** The slice of a `GET /orders` row the duplicate guard reads. */
export interface ShoperOrderRef {
  readonly order_id: string;
  readonly notes_priv?: string | null;
}
