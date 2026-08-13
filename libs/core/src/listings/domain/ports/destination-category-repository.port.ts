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
   * Watermark sweep: rows the completing run did not observe are gone upstream.
   * Deleting them is what makes a mapping to a removed category fail loudly
   * instead of resolving to a stale node (ADR-037).
   */
  deleteStaleBelow(scope: TaxonomyScope, syncedAt: Date): Promise<number>;
}
