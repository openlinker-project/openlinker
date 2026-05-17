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
 * Per-EAN outcome of a batch category match call.
 *
 * - `matched`: unique product card found in Allegro's catalogue with this EAN;
 *   `allegroCategoryId` is the category-id reported on that card, ready to
 *   pre-fill the review-table row. `productCardId` is the Allegro
 *   product-card UUID — passed through to `productSet[0].product.id` at
 *   offer-create time so the offer smart-links to the catalogue card.
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
  | { kind: 'matched'; allegroCategoryId: string; productCardId: string }
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
