/**
 * EAN Category Match Types
 *
 * Types for the `EanCategoryMatcher` capability (#735) — the per-variant
 * outcome envelope a batch EAN→category resolver returns, plus its batch
 * input shape.
 *
 * Consumed by the bulk-submission service in #736 to drive the review-table
 * row state on the Allegro bulk-listing flow (`docs/specs/product-spec-726-
 * allegro-bulk-listing.md` § 4.5).
 *
 * @module libs/core/src/listings/domain/types
 */

/**
 * Runtime array of the per-EAN outcome discriminants. Required by
 * `engineering-standards.md § Union Types: as const Pattern` — even for
 * unions that don't cross HTTP/DB today, the runtime array is what makes
 * future validation, `@IsIn` decorators, and Swagger schemas work without
 * a refactor.
 */
export const EanMatchResultKindValues = [
  'matched',
  'multi-match',
  'no-ean',
  'no-match',
] as const;

export type EanMatchResultKind = (typeof EanMatchResultKindValues)[number];

/**
 * How a `matched` batch result was resolved (#1522).
 *
 * - `auto_detect`: unique product card found in the marketplace catalogue by
 *   EAN (the adapter's `EanCategoryMatcher` path). This is the default and the
 *   only value adapters ever produce — the field is absent on their results.
 * - `category_mapping`: no catalogue match for the EAN, but the operator's
 *   configured per-source-category mapping resolved the destination category.
 *   Set only by `CategoryResolutionService.resolveCategoriesBatch` on the
 *   mapping-fallback path; carries no catalogue card (`productCardId` is empty).
 */
export const EanMatchMethodValues = ['auto_detect', 'category_mapping'] as const;

export type EanMatchMethod = (typeof EanMatchMethodValues)[number];

/**
 * Per-EAN outcome of a batch category match call.
 *
 * - `matched`: a destination category was resolved for this variant.
 *   `allegroCategoryId` is the resolved category-id, ready to pre-fill the
 *   review-table row. `productCardId` is the marketplace product-card UUID
 *   (Allegro) — passed through to `productSet[0].product.id` at offer-create
 *   time so the offer smart-links to the catalogue card; it is empty on the
 *   `category_mapping` fallback path (no catalogue card, #1522). `method`
 *   distinguishes an EAN catalogue match (`auto_detect`, the default when the
 *   field is absent) from the configured-mapping fallback (`category_mapping`).
 * - `multi-match`: more than one product card matched the EAN (rare but
 *   real — duplicate cards exist on Allegro's catalogue). Caller MUST surface
 *   candidate selection UX (#740). Ordering preserves Allegro's relevance
 *   ranking — top candidate first.
 * - `no-ean`: the variant has no EAN — caller must fall back to manual
 *   category pick.
 * - `no-match`: Allegro returned zero exact matches for this EAN (or the
 *   resolver-side HTTP call failed and collapsed to no-match per the
 *   no-throw contract).
 */
export type EanMatchResult =
  | { kind: 'matched'; allegroCategoryId: string; productCardId: string; method?: EanMatchMethod }
  | { kind: 'multi-match'; candidates: EanMatchCandidate[] }
  | { kind: 'no-ean' }
  | { kind: 'no-match' };

export interface EanMatchCandidate {
  allegroCategoryId: string;
  productCardId: string;
  /** Display name from Allegro for the review-table candidate picker. */
  name?: string;
}

/**
 * Batch input for `EanCategoryMatcher.resolveCategoriesForBatchByEan`.
 *
 * The caller (#736's bulk-submission service) pre-resolves variants to
 * `{ variantId, ean }` pairs and hands them in; the plugin doesn't reach
 * back into `@openlinker/core/products`. EAN of `null` (or empty / whitespace
 * string) is treated as no-EAN and never produces an HTTP call.
 */
export interface BatchCategoryByEanInput {
  items: Array<{ variantId: string; ean: string | null }>;
}
