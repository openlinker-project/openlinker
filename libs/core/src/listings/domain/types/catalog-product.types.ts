/**
 * Catalog Product Types
 *
 * Neutral DTO shapes for marketplace catalog-product lookup (#633). The
 * `CatalogProductReader` sub-capability returns these — no platform-specific
 * fields are permitted here. Adapters map their native shape onto these.
 *
 * `CatalogProductParameter.parameterId` is intentionally a string matching
 * the `CategoryParameter.id` produced by `CategoryParametersReader`, so the
 * FE can merge catalog values onto Step 2's parameter form state by id.
 *
 * @module libs/core/src/listings/domain/types
 */

export const CatalogProductMatchKindValues = ['unique', 'ambiguous', 'no_match'] as const;
export type CatalogProductMatchKind = (typeof CatalogProductMatchKindValues)[number];

export interface FindProductsByBarcodeInput {
  /** Product barcode (EAN/GTIN). Required. */
  barcode: string;
  /**
   * Marketplace category id to narrow the search.
   *
   * Adapters MAY require this — when omitted they MUST return
   * `{ kind: 'no_match' }` rather than performing a category-less search.
   * The Allegro adapter ships today with this requirement; future adapters
   * are free to support category-less lookup.
   */
  categoryId?: string;
}

export interface CatalogProductSummary {
  id: string;
  name: string;
  ean?: string;
  /**
   * URL of a small thumbnail for the operator's visual identification.
   * Present on `unique` matches; presence on `ambiguous` summary entries is
   * adapter-best-effort (Allegro's `/sale/products?phrase` summaries do not
   * always carry image URLs).
   */
  imageUrl?: string;
}

export interface CatalogProductParameter {
  /** Stable parameter id; matches `CategoryParameter.id` for FE merge. */
  parameterId: string;
  name: string;
  /** Dictionary value ids (mutually exclusive with `valueStrings`). */
  valueIds?: string[];
  /** Free-text values (mutually exclusive with `valueIds`). */
  valueStrings?: string[];
}

export interface CatalogProduct extends CatalogProductSummary {
  description?: string;
  /** Ordered list of image URLs (first is canonical). */
  images?: string[];
  /** Product-section parameters carried by the catalog entry. */
  parameters: CatalogProductParameter[];
}

export type CatalogProductMatchResult =
  | { kind: 'unique'; product: CatalogProduct }
  | { kind: 'ambiguous'; products: CatalogProductSummary[] }
  | { kind: 'no_match' };
