/**
 * Category Resolution Types
 *
 * Types for the provenance-aware destination-category placement chain
 * (ADR-023 §1). The resolution service walks a capability-gated fallback
 * chain: provision → barcode → per-source-category mapping → manual,
 * returning a neutral `{ destinationCategoryId, provenance, method }`.
 *
 * @module libs/core/src/listings/application/types
 */

export const CategoryResolutionMethodValues = [
  // ADR-023 §1 step 1 — destination provisions/mirrors the source category path.
  // Gated on the `CategoryProvisioner` capability (delivered by #1041); a no-op
  // until then, so this value is currently unreachable.
  'provision',
  // Step 2 — barcode/GTIN catalog auto-detect.
  'auto_detect',
  // Step 3 — configured per-source-category mapping.
  'category_mapping',
  // Step 4 — operator picks manually (no id resolved).
  'manual',
] as const;

export type CategoryResolutionMethod = (typeof CategoryResolutionMethodValues)[number];

/**
 * How a destination relates to the taxonomy whose ids it resolves against
 * (ADR-023). Derived from the destination adapter's *capabilities*, never its
 * `platformType`. Drives attribute projection downstream (#1039): `borrows`
 * destinations emit source-provenance ids verbatim; `owns` destinations
 * resolve against their own dictionary.
 */
export const CategoryProvenanceValues = [
  // Has its own category tree + per-category parameter schema (Allegro).
  'owns',
  // Accepts another connection's taxonomy ids verbatim, ships no own tree (ERLI).
  'borrows',
  // No fixed tree; placement is provisioning/mirroring (shop). Reachable once
  // #1041 adds the `CategoryProvisioner` capability.
  'open',
] as const;

export type CategoryProvenance = (typeof CategoryProvenanceValues)[number];

export interface CategoryResolutionInput {
  /** Destination marketplace/shop connection ID */
  connectionId: string;
  /**
   * EAN or GTIN barcode for auto-detect (barcode step).
   * If omitted, auto-detect is skipped entirely.
   */
  barcode?: string | null;
  /**
   * Source platform category IDs for the mapping step, ordered deepest-first.
   * If both `barcode` and `sourceCategoryIds` are omitted, resolution returns `manual`.
   */
  sourceCategoryIds?: string[];
}

export interface CategoryResolutionResult {
  /** Resolved destination category ID, or null if manual pick is needed */
  destinationCategoryId: string | null;
  /**
   * Taxonomy relationship of the destination the id was resolved against, or
   * `null` when no destination adapter was resolved (no-barcode / fallback /
   * manual paths). Populated on the barcode path; the mapping-path provenance
   * lands with #1045.
   */
  provenance: CategoryProvenance | null;
  /** Which resolution method produced the result */
  method: CategoryResolutionMethod;
}
