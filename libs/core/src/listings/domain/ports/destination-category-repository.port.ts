/**
 * Destination Category Repository Port (#1979, ADR-037)
 *
 * Persistence contract for the destination-taxonomy projection. Deliberately
 * minimal — only what `DestinationTaxonomyService` needs.
 *
 * @module libs/core/src/listings/domain/ports
 */
import type { DestinationCategory } from '../entities/destination-category.entity';
import type {
  DestinationCategorySearchHit,
  DestinationCategoryUpsert,
  TaxonomyScope,
} from '../types/destination-category.types';

export interface DestinationCategoryRepositoryPort {
  /** One tree level. `parentId: null` returns the roots. */
  browse(scope: TaxonomyScope, parentId: string | null): Promise<DestinationCategory[]>;

  /**
   * Trigram search over the whole scope, each hit carrying its derived
   * breadcrumb. `limit` is clamped by the caller before it reaches here.
   */
  search(
    scope: TaxonomyScope,
    query: string,
    limit: number,
  ): Promise<DestinationCategorySearchHit[]>;

  /**
   * Insert-or-update a batch, stamping `syncedAt` on every row it touches.
   * Concurrency-safe by construction (single-statement upsert), so two runs
   * racing the same scope cannot produce a duplicate-key failure.
   */
  upsertMany(
    scope: TaxonomyScope,
    nodes: readonly DestinationCategoryUpsert[],
    syncedAt: Date,
  ): Promise<number>;

  /**
   * The sync frontier, derived rather than carried (#2061): externalIds in
   * scope that this run has observed (`syncedAt = runStartedAt`), can expand
   * (`leaf IS NOT TRUE`), and has not expanded yet.
   *
   * Ordered for reproducibility, not correctness — every returned row must
   * eventually be expanded, so page order cannot change the outcome.
   */
  findExpandable(
    scope: TaxonomyScope,
    runStartedAt: Date,
    limit: number,
  ): Promise<string[]>;

  /**
   * Record that this run expanded these nodes' children.
   *
   * Called only AFTER the children are upserted: a crash in between must leave
   * the parent unexpanded (retried next tick), never expanded-with-unstamped-
   * children — which would record the work as done while its children sit below
   * the watermark, so the completing sweep would delete them.
   */
  markExpanded(
    scope: TaxonomyScope,
    externalIds: readonly string[],
    runStartedAt: Date,
  ): Promise<void>;

  /**
   * How many rows in scope this run has observed.
   *
   * Guards the sweep. "The frontier is empty" alone does NOT mean the run
   * finished its work — it also describes a run whose rows are missing entirely
   * (a resumed watermark whose rows were deleted, or a root browse that
   * returned nothing). Sweeping on that reading deletes the whole scope.
   */
  countObserved(scope: TaxonomyScope, runStartedAt: Date): Promise<number>;

  /**
   * Watermark sweep: rows the completing run did not observe are gone upstream.
   * Deleting them is what makes a mapping to a removed category fail loudly
   * instead of resolving to a stale node (ADR-037).
   */
  deleteStaleBelow(scope: TaxonomyScope, syncedAt: Date): Promise<number>;
}
