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

export const TaxonomyOwnerValues = ['allegro'] as const;

export type TaxonomyOwner = (typeof TaxonomyOwnerValues)[number];
