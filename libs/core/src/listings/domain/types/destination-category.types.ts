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

/** Resumable breadth-first sync progress, persisted by the worker handler. */
export interface TaxonomyFrontier {
  /**
   * Watermark for the whole run, held across ticks so a multi-tick sync sweeps
   * disappearance against ONE consistent value rather than a moving one.
   */
  runStartedAt: string;
  /** Parent ids still to expand; `null` is the synthetic root level. */
  pending: (string | null)[];
}

export interface TaxonomySyncInput {
  /** `null` starts a fresh run; a stored frontier resumes one. */
  frontier: TaxonomyFrontier | null;
  /** Max nodes expanded this run. Bounds a thousands-of-nodes first sync. */
  pageLimit?: number;
}

export interface TaxonomySyncResult {
  /** `null` once the run completed — the handler clears the stored cursor. */
  nextFrontier: TaxonomyFrontier | null;
  upserted: number;
  /** Rows below the watermark, deleted only on the completing run. */
  removed: number;
  completed: boolean;
}
