/**
 * Destination Taxonomy Service Interface (#1979, ADR-037)
 *
 * The single neutral seam for reading a destination's category tree, spanning
 * marketplace (`CategoryBrowser`) and shop (`ShopCategoryBrowser`) destinations.
 * Callers pass the CONNECTION they are working with; the service resolves it to
 * a taxonomy scope, so a borrowing destination (Erli reading Allegro's tree)
 * needs no special handling at the call site.
 *
 * @module libs/core/src/listings/application/interfaces
 */
import type { DestinationCategory } from '../../domain/entities/destination-category.entity';
import type {
  DestinationCategorySearchHit,
  TaxonomyScope,
  TaxonomySyncInput,
  TaxonomySyncResult,
} from '../../domain/types/destination-category.types';

export interface IDestinationTaxonomyService {
  /**
   * One level of the tree. Reads the projection ONLY — never the live platform.
   */
  browse(connectionId: string, parentId?: string): Promise<DestinationCategory[]>;

  /**
   * Substring search across the whole scope, each hit carrying its breadcrumb.
   *
   * This is the capability the projection exists for: the pre-#1979 pickers
   * filtered only the currently-loaded level, so a root-level search returned
   * nothing and an operator concluded the category did not exist.
   */
  search(
    connectionId: string,
    query: string,
    limit?: number,
  ): Promise<DestinationCategorySearchHit[]>;

  /**
   * Refresh path — the ONLY caller of the live browse capability.
   *
   * Pure with respect to progress: the caller supplies the frontier and
   * persists the returned one, so `listings` never reaches the `sync` context's
   * cursor repository (a cross-context repository-port import is forbidden).
   */
  syncTaxonomy(connectionId: string, input: TaxonomySyncInput): Promise<TaxonomySyncResult>;

  /** Which row set this connection reads/writes. Memoised per connection. */
  resolveScope(connectionId: string): Promise<TaxonomyScope>;
}
