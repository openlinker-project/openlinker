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
 *
 * The country axis is not the only one. `'allegro:sandbox'` exists because
 * Allegro's required `environment` config resolves to a different API host, so a
 * sandbox connection and a production connection publish genuinely different
 * trees under one `platformType` (#2063). The shared-across-marketplaces
 * evidence above covers the country axis ONLY — it says nothing about
 * environment, and reading it as blanket "Allegro has one tree" is what let a
 * sandbox connection overwrite production rows and then delete them on the
 * watermark sweep.
 *
 * NOTE ON ENFORCEMENT (#2063): this set is a **compile-time vocabulary**, not a
 * runtime allowlist. Until #2063 it doubled as a membership gate that
 * `resolveTaxonomyOwner` tested `platformType` against; that inference is gone —
 * an adapter now DECLARES its identity via `TaxonomyIdentityProvider` and is
 * merely typed against this union. So nothing at runtime stops a wrong-but-typed
 * value; the one-value-per-distinct-tree rule is upheld by review of what
 * `getTaxonomyIdentity()` returns. Getting it wrong is a data migration of every
 * `DestinationCategory` row, so weigh a new value here accordingly.
 */
export const TaxonomyOwnerValues = ['allegro', 'allegro:sandbox'] as const;

export type TaxonomyOwner = (typeof TaxonomyOwnerValues)[number];
