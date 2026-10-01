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

/** The slice of `GET /application-config` the adapter reads. */
export interface ShoperApplicationConfig {
  readonly default_language_name: string;
  readonly default_currency_name: string;
  readonly locale_default_weight: string;
}
