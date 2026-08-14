/**
 * Destination Category Types (#1979, ADR-037)
 *
 * Shapes for the neutral destination-taxonomy projection — the read model that
 * replaces the platform-named `allegro_category_cache` and gives marketplace and
 * shop destinations one queryable taxonomy surface.
 *
 * @module libs/core/src/listings/domain/types
 * @see {@link DestinationCategory} for the projected node entity
 */
import type { CategoryPathSegment } from './category.types';
import type { TaxonomyOwner } from './taxonomy-owner.types';

/**
 * Which row set a caller reads or writes.
 *
 * Exactly one member is non-null (ADR-037). The discriminator is "is this tree
 * identical for every connection to that platform?":
 *  - marketplace => owner-keyed, because every seller shares one tree, so two
 *    connections to the same marketplace must never duplicate it (and a
 *    borrowing destination reads the owner's rows);
 *  - shop => connection-keyed, because a shop authors its own categories.
 */
export type TaxonomyScope =
  | { taxonomyOwner: TaxonomyOwner; connectionId: null }
  | { taxonomyOwner: null; connectionId: string };

/**
 * Sync-time write shape for one node.
 *
 * Carries no `searchText`: the normalized trigram column is derived by the
 * repository, so callers never restate the normalization strategy.
 */
export interface DestinationCategoryUpsert {
  externalId: string;
  name: string;
  parentId: string | null;
  /**
   * `null` for a shop node. A marketplace taxonomy is leaf-gated and a shop's is
   * not (ADR-024), and in a projection that difference is data, not a type fork.
   */
  leaf: boolean | null;
}

/**
 * One `search` hit plus its root -> leaf breadcrumb.
 *
 * The breadcrumb is DERIVED per query (recursive CTE over the matched rows), not
 * materialized: a resumable paged sync inserts children before their ancestors
 * exist, so a stored path could not be computed at insert time and a rename
 * would invalidate every descendant's (ADR-037 § Decision).
 */
export interface DestinationCategorySearchHit {
  category: DestinationCategoryLike;
  path: CategoryPathSegment[];
}

/**
 * Structural view of the projected node, so this types file stays free of an
 * entity import cycle. `DestinationCategory` (the domain entity) satisfies it.
 */
export interface DestinationCategoryLike {
  taxonomyOwner: TaxonomyOwner | null;
  connectionId: string | null;
  externalId: string;
  name: string;
  parentId: string | null;
  leaf: boolean | null;
  syncedAt: Date;
}

export interface TaxonomySyncInput {
  /**
   * Watermark of the run to continue, or `null` to start a fresh one.
   *
   * This is the WHOLE of the persisted progress since #2061 — the per-node
   * detail ("which parents still need expanding") is derived by querying the
   * projection for rows carrying this watermark that are not yet expanded. The
   * cursor is therefore scalar again, like every other cursor in the repo.
   *
   * The root level is synthetic (it owns no row), so `null` is not merely an
   * optimisation: it is how a run knows it still has to browse the roots.
   */
  runStartedAt: string | null;
  /** Max nodes expanded this run. Bounds a thousands-of-nodes first sync. */
  pageLimit?: number;
}

export interface TaxonomySyncResult {
  /** `null` once the run completed — the handler clears the stored cursor. */
  nextRunStartedAt: string | null;
  upserted: number;
  /**
   * Rows below the watermark, deleted only on a completing run that actually
   * OBSERVED something. A run that saw zero rows in its scope does not sweep —
   * see `DestinationTaxonomyService` for why that guard is load-bearing.
   */
  removed: number;
  completed: boolean;
}
