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

import type { TaxonomyOwner } from '../../domain/types/taxonomy-owner.types';

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
  /**
   * Owner taxonomy this destination borrows (#1045). Present only for a
   * `borrows` destination (ERLI → `'allegro'`); the caller reads it from the
   * destination adapter's `TaxonomyBorrower` capability and threads it here so
   * the mapping step can reuse an owner-authored row with zero re-authoring.
   * Absent for `owns` / `open` destinations.
   */
  borrowedTaxonomy?: TaxonomyOwner;
  /**
   * Source (master) connection id, threaded by the caller to scope the
   * borrowed-taxonomy mapping fallback to the right source store (#1045) — the
   * containment for multi-owner-connection ambiguity. Absent ⇒ the fallback is
   * provenance-only (oldest-wins + warn).
   */
  sourceConnectionId?: string;
}

/**
 * One variant's input to the bulk Resolve batch (#795, mapping-aware #1522).
 * `sourceCategoryIds` is the per-source-category mapping fallback input —
 * ordered deepest-first — consulted when the EAN yields no catalogue match
 * (mirrors `CategoryResolutionInput.sourceCategoryIds` on the single-resolve
 * chain). Absent/empty ⇒ EAN-only for that item (legacy behaviour).
 */
export interface BatchCategoryResolveItem {
  variantId: string;
  ean: string | null;
  sourceCategoryIds?: string[];
}

/**
 * Batch input for `ICategoryResolutionService.resolveCategoriesBatch` (#1522).
 * A superset of the adapter-facing `BatchCategoryByEanInput`: each item may
 * additionally carry `sourceCategoryIds` so the service can fall back to the
 * configured mapping on an EAN no-match. The adapter still receives only
 * `{ variantId, ean }` — the mapping fallback is a core concern.
 */
export interface BatchCategoryResolveInput {
  items: BatchCategoryResolveItem[];
}

export interface CategoryResolutionResult {
  /** Resolved destination category ID, or null if manual pick is needed */
  destinationCategoryId: string | null;
  /**
   * Taxonomy relationship of the destination the id was resolved against, or
   * `null` when unknown. Populated on the barcode path (derived from the
   * resolved adapter) and, for a `borrows` destination, on the mapping/manual
   * paths from the threaded `borrowedTaxonomy` (#1045). Stays `null` for
   * `owns`/`open` destinations on the non-barcode paths (no adapter resolved).
   */
  provenance: CategoryProvenance | null;
  /** Which resolution method produced the result */
  method: CategoryResolutionMethod;
}
