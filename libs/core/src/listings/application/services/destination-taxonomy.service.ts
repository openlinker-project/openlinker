/**
 * Destination Taxonomy Service (#1979, ADR-037)
 *
 * Reads and refreshes the neutral destination-taxonomy projection. Reads hit
 * OpenLinker's own store only; the live browse capability is used exclusively by
 * `syncTaxonomy`. That inversion is the point of the model — walking a tree is
 * N platform calls, and a taxonomy you must paginate one parent at a time cannot
 * be searched at all (ADR-033 § Phase 1 amendments established the OL-store
 * principle this follows).
 *
 * @module libs/core/src/listings/application/services
 * @implements {IDestinationTaxonomyService}
 * @see {@link IDestinationTaxonomyService} for the service contract
 */
import { Inject, Injectable } from '@nestjs/common';

import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';

import { DESTINATION_CATEGORY_REPOSITORY_TOKEN } from '../../listings.tokens';
import { TaxonomySourceUnavailableException } from '../../domain/exceptions/taxonomy-source-unavailable.exception';
import { isCategoryBrowser } from '../../domain/ports/capabilities/category-browser.capability';
import { isShopCategoryBrowser } from '../../domain/ports/capabilities/shop-category-browser.capability';
import { resolveTaxonomyOwner } from '../../domain/resolve-taxonomy-owner';
import type { OfferManagerPort } from '../../domain/ports/offer-manager.port';
import type { ShopProductManagerPort } from '../../domain/ports/shop-product-manager.port';
import type { DestinationCategory } from '../../domain/entities/destination-category.entity';
import { DestinationCategoryRepositoryPort } from '../../domain/ports/destination-category-repository.port';
import type {
  DestinationCategorySearchHit,
  DestinationCategoryUpsert,
  TaxonomyFrontier,
  TaxonomyScope,
  TaxonomySyncInput,
  TaxonomySyncResult,
} from '../../domain/types/destination-category.types';
import type { IDestinationTaxonomyService } from '../interfaces/destination-taxonomy.service.interface';

const SEARCH_LIMIT_DEFAULT = 20;
/** `search` is agent-reachable in Wave 4, so an unbounded limit is untrusted input. */
const SEARCH_LIMIT_MAX = 100;
const SYNC_PAGE_LIMIT_DEFAULT = 500;
/**
 * A resumable run older than this is abandoned and restarted from the roots.
 *
 * Without it a stale frontier silently DISABLES disappearance detection: the
 * sweep deletes rows below the run's OWN `runStartedAt`, so resuming a run
 * started weeks ago matches nothing (every row is newer) and `deleteStaleBelow`
 * becomes a no-op while still reporting the run complete. A frontier can go
 * stale whenever the elected source connection changes — the cursor is written
 * per connection, but a marketplace run's real subject is the owner. Making the
 * run owner-portable (and the cursor scalar again) is tracked as **#2061**.
 */
const MAX_FRONTIER_AGE_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class DestinationTaxonomyService implements IDestinationTaxonomyService {
  private readonly logger = new Logger(DestinationTaxonomyService.name);

  /**
   * Connection -> scope memo. ADR-037 flags this as the obvious memoisation
   * target: resolving a scope probes the integrations registry, and `browse`
   * would otherwise pay that on every level of a drill-down. A connection's
   * destination kind does not change without a restart-level config change.
   */
  private readonly scopeCache = new Map<string, TaxonomyScope>();

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(DESTINATION_CATEGORY_REPOSITORY_TOKEN)
    private readonly repository: DestinationCategoryRepositoryPort,
  ) {}

  async browse(connectionId: string, parentId?: string): Promise<DestinationCategory[]> {
    const scope = await this.resolveScope(connectionId);
    return this.repository.browse(scope, parentId ?? null);
  }

  async search(
    connectionId: string,
    query: string,
    limit?: number,
  ): Promise<DestinationCategorySearchHit[]> {
    const scope = await this.resolveScope(connectionId);
    const effectiveLimit = Math.min(
      Math.max(1, Math.trunc(limit ?? SEARCH_LIMIT_DEFAULT)),
      SEARCH_LIMIT_MAX,
    );
    return this.repository.search(scope, query, effectiveLimit);
  }

  async syncTaxonomy(connectionId: string, input: TaxonomySyncInput): Promise<TaxonomySyncResult> {
    // One probe for both halves — `resolveScope` would re-run the same adapter
    // resolution on a cache miss.
    const { scope, browse: openBrowse } = await this.resolveDestination(connectionId);
    this.scopeCache.set(connectionId, scope);
    const browse = openBrowse();

    const pageLimit = input.pageLimit ?? SYNC_PAGE_LIMIT_DEFAULT;
    const resumed = this.usableFrontier(input.frontier, connectionId);
    const runStartedAt = resumed?.runStartedAt ?? new Date().toISOString();
    const syncedAt = new Date(runStartedAt);

    // De-duplicated on resume as well as on push: a node reachable from two
    // parents (legal in several marketplace taxonomies) would otherwise be
    // enqueued twice, and a cycle would grow the frontier faster than
    // `pageLimit` drains it — so the run would never complete and the watermark
    // sweep would never fire.
    const pending: (string | null)[] = resumed ? [...new Set(resumed.pending)] : [null];
    const enqueued = new Set<string>(pending.filter((id): id is string => id !== null));

    let upserted = 0;
    let expanded = 0;

    while (pending.length > 0 && expanded < pageLimit) {
      const parentId = pending.shift() ?? null;
      const children = await browse(parentId ?? undefined);
      expanded += 1;

      if (children.length === 0) {
        continue;
      }

      upserted += await this.repository.upsertMany(scope, children, syncedAt);

      for (const child of children) {
        // A leaf-gated marketplace node has nothing below it. A shop node carries
        // `leaf: null` (any node is a valid target) and is always expanded — a
        // shop tree is small enough that walking it fully is cheap.
        if (child.leaf === true || enqueued.has(child.externalId)) {
          continue;
        }
        enqueued.add(child.externalId);
        pending.push(child.externalId);
      }
    }

    const completed = pending.length === 0;
    let removed = 0;

    if (completed) {
      removed = await this.repository.deleteStaleBelow(scope, syncedAt);
    }

    this.logger.log(
      `destination.taxonomy.sync (connection=${connectionId}, scope=${this.describeScope(scope)}): ` +
        `expanded=${expanded}, upserted=${upserted}, removed=${removed}, pending=${pending.length}, completed=${String(completed)}`,
    );

    if (!completed) {
      // Visible non-termination signal: `deleteStaleBelow` only fires on a
      // completing run, so a tree that outgrows `pageLimit` would never sweep
      // and a removed category would linger as a resolvable mapping target.
      this.logger.debug(
        `Taxonomy sync for connection ${connectionId} did not drain: ${pending.length} parent(s) still pending`,
      );
    }

    return {
      nextFrontier: completed ? null : ({ runStartedAt, pending } satisfies TaxonomyFrontier),
      upserted,
      removed,
      completed,
    };
  }

  async resolveScope(connectionId: string): Promise<TaxonomyScope> {
    const cached = this.scopeCache.get(connectionId);
    if (cached) {
      return cached;
    }

    const scope = (await this.resolveDestination(connectionId)).scope;
    this.scopeCache.set(connectionId, scope);
    return scope;
  }

  /**
   * Probe `OfferManager` then `ProductPublisher` to resolve BOTH the scope and
   * the browse function — capability-driven, never a `platformType` switch.
   *
   * `TaxonomyBorrower` only identifies a *borrower* (Erli); nothing declares
   * that an Allegro connection *owns* `'allegro'`. So an owning marketplace's
   * owner value comes from its `platformType`, validated against the closed
   * `TaxonomyOwnerValues` set — a membership check that throws on an unlisted
   * platform, so a new marketplace cannot silently write rows under a bogus
   * owner (which would be a data migration to undo).
   */
  private async resolveDestination(connectionId: string): Promise<{
    scope: TaxonomyScope;
    /**
     * Deferred on purpose: a borrowing connection with no catalogue credentials
     * can still READ the owner's rows, and only the refresh path is unavailable.
     * Building the browse function eagerly would make `resolveScope` — and so
     * every `browse`/`search` — throw for exactly that connection.
     */
    browse: () => (parentId?: string) => Promise<DestinationCategoryUpsert[]>;
  }> {
    const offerManager = await this.tryGetAdapter<OfferManagerPort>(connectionId, 'OfferManager');

    if (offerManager) {
      const { connection } = await this.integrationsService.getAdapter(connectionId);
      // Shared with the scheduler's election so the two cannot disagree.
      const owningTaxonomy = resolveTaxonomyOwner(offerManager, connection.platformType);

      if (owningTaxonomy !== null) {
        return {
          scope: { taxonomyOwner: owningTaxonomy, connectionId: null },
          browse: () => this.marketplaceBrowseFn(connectionId, offerManager),
        };
      }
    }

    const shopManager = await this.tryGetAdapter<ShopProductManagerPort>(
      connectionId,
      'ProductPublisher',
    );

    if (shopManager && isShopCategoryBrowser(shopManager)) {
      return {
        scope: { taxonomyOwner: null, connectionId },
        browse:
          () =>
          async (parentId?: string): Promise<DestinationCategoryUpsert[]> =>
            (await shopManager.browseCategories(parentId)).map((category) => ({
              externalId: category.id,
              name: category.name,
              parentId: category.parentId,
              // A shop accepts a product in ANY node, so it has no leaf concept.
              leaf: null,
            })),
      };
    }

    // Distinguish "cannot browse at all" from "browses a tree we have not
    // vetted": the second is actionable (add the value to TaxonomyOwnerValues
    // once confirmed it publishes one distinct tree), and reporting it as a
    // missing capability would send the reader looking in the wrong place.
    throw new TaxonomySourceUnavailableException(
      connectionId,
      offerManager && isCategoryBrowser(offerManager)
        ? 'the connection browses a marketplace taxonomy whose platform is not a known taxonomy owner — add it to TaxonomyOwnerValues after confirming it publishes one distinct tree'
        : 'no CategoryBrowser, TaxonomyBorrower, or ShopCategoryBrowser capability',
    );
  }

  private marketplaceBrowseFn(
    connectionId: string,
    adapter: OfferManagerPort,
  ): (parentId?: string) => Promise<DestinationCategoryUpsert[]> {
    if (!isCategoryBrowser(adapter)) {
      // Reachable for a borrower whose own adapter cannot browse — e.g. an Erli
      // connection with no catalogue credentials, since `ErliOfferManagerAdapter`
      // assigns `fetchCategories` conditionally in its constructor (ADR-031).
      // The owner's rows are still readable; only the refresh path is unavailable.
      throw new TaxonomySourceUnavailableException(
        connectionId,
        'connection borrows a taxonomy but cannot browse it (no catalogue credentials)',
      );
    }

    return async (parentId?: string) =>
      (await adapter.fetchCategories(parentId)).map((category) => ({
        externalId: category.id,
        name: category.name,
        parentId: category.parentId,
        leaf: category.leaf,
      }));
  }

  /**
   * Drop a resumable frontier that is unusable, so the run restarts cleanly
   * rather than completing against a watermark that can no longer sweep.
   */
  private usableFrontier(
    frontier: TaxonomyFrontier | null,
    connectionId: string,
  ): TaxonomyFrontier | null {
    if (frontier === null) {
      return null;
    }

    const startedAt = Date.parse(frontier.runStartedAt);
    if (Number.isNaN(startedAt)) {
      this.logger.warn(
        `Discarding unparseable taxonomy frontier for connection ${connectionId}; restarting from the roots`,
      );
      return null;
    }

    const ageMs = Date.now() - startedAt;
    if (ageMs > MAX_FRONTIER_AGE_MS) {
      this.logger.warn(
        `Discarding taxonomy frontier for connection ${connectionId}: run started ${frontier.runStartedAt} ` +
          `(${Math.round(ageMs / 3_600_000)}h ago) is past the ${MAX_FRONTIER_AGE_MS / 3_600_000}h limit. ` +
          `Restarting so the watermark sweep stays effective.`,
      );
      return null;
    }

    return frontier;
  }

  private async tryGetAdapter<T>(connectionId: string, capability: string): Promise<T | null> {
    try {
      return await this.integrationsService.getCapabilityAdapter<T>(connectionId, capability);
    } catch {
      // A destination legitimately supports only one of the two kinds; probing
      // is how the kind is discovered, so an unsupported capability is expected
      // rather than exceptional.
      return null;
    }
  }

  private describeScope(scope: TaxonomyScope): string {
    return scope.taxonomyOwner !== null
      ? `owner:${scope.taxonomyOwner}`
      : `connection:${scope.connectionId ?? 'unknown'}`;
  }
}
