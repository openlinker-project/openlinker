/**
 * Taxonomy Owner Type
 *
 * Identifies WHICH owner's taxonomy a `borrows` destination consumes verbatim
 * (ADR-023 §40/§83). Distinct from `CategoryProvenance` (the relationship kind
 * owns|borrows|open): a `borrows` destination (ERLI) additionally declares the
 * owner taxonomy whose already-resolved category/parameter ids it reuses, so the
 * mapping store can resolve an owner-authored row for it with zero re-authoring
 * (#1045). Mirrors the `destination_taxonomy_provenance` column value carried on
 * `category_mappings` / `attribute_mappings`.
 *
 * Open-world by intent (mirrors the capability/platformType open sets); today
 * only `allegro` is a borrowed owner taxonomy.
 *
 * @module libs/core/src/listings/domain/types
 */

/**
 * The rule is ONE VALUE PER DISTINCT TREE (ADR-037) — coarser than a connection,
 * often finer than a platform. Widening or splitting a value after rows exist is
 * a data migration of every `DestinationCategory` row AND every category mapping
 * referencing one, so the granularity is fixed before the first row is written.
 *
 * `'allegro'` is unqualified by region, and that is verified rather than assumed:
 * Allegro's developer portal states the category tree and parameters are SHARED
 * across all its marketplaces (.pl/.cz/.sk/.hu) — one tree published in several
 * languages, with consistent identifiers. So a region-qualified `'allegro:pl'`
 * would be a false distinction. Do not re-open this without new evidence.
 *
 * Platforms that genuinely publish several trees take qualified values instead:
 * eBay gives a tree its own identity (`getDefaultCategoryTreeId` returns a
 * `categoryTreeId` that is NOT the marketplace id, and several marketplaces may
 * share one), and Amazon's browse nodes are per-`MarketplaceId` — those onboard
 * as `'ebay:EBAY_US'` / `'amazon:ATVPDKIKX0DER'`, never as `'ebay'`.
 */
export const TaxonomyOwnerValues = ['allegro'] as const;

export type TaxonomyOwner = (typeof TaxonomyOwnerValues)[number];
