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
import { SYNC_LOCK_TOKEN } from '@openlinker/core/sync';
import { SyncLockPort } from '@openlinker/core/sync';
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
  TaxonomyScope,
  TaxonomySyncInput,
  TaxonomySyncResult,
} from '../../domain/types/destination-category.types';
import type { IDestinationTaxonomyService } from '../interfaces/destination-taxonomy.service.interface';
import { TAXONOMY_SYNC_LOCK_TTL_MS, taxonomySyncLockKey } from './taxonomy-sync-lock';

const SEARCH_LIMIT_DEFAULT = 20;
/** `search` is agent-reachable in Wave 4, so an unbounded limit is untrusted input. */
const SEARCH_LIMIT_MAX = 100;
const SYNC_PAGE_LIMIT_DEFAULT = 500;
/**
 * A resumable run older than this is abandoned and restarted from the roots.
 *
 * **Its justification changed with #2061, and the new one is weaker.** Wave 1
 * needed this for CORRECTNESS: the frontier lived on a per-connection cursor,
 * so a re-election orphaned it, and resuming a stale one swept against a
 * watermark that matched nothing — silently disabling disappearance detection
 * while still reporting the run complete.
 *
 * Progress is now derived from the projection, so a resumed run keeps stamping
 * its own consistent watermark and its sweep still means exactly "everything
 * this run did not observe", at any age. What age costs now is FRESHNESS: a run
 * resumed after days publishes a days-old tree.
 *
 * So the guard survives as a freshness policy, relaxed from 6h to 24h. Removing
 * it entirely would let a run interrupted indefinitely — a connection disabled
 * and re-enabled a month later — resume and complete against month-old data.
 */
const MAX_RUN_AGE_MS = 24 * 60 * 60 * 1000;

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
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
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

    // Serialize per SCOPE, so ADR-037's "at most one in-flight run per owner"
    // is enforced rather than merely claimed. Keyed off the RESOLVED scope, the
    // same authority the cursor key uses (#2063).
    const lockKey = taxonomySyncLockKey(scope);
    const lockToken = await this.syncLock.acquire(lockKey, TAXONOMY_SYNC_LOCK_TTL_MS);

    if (lockToken === null) {
      // Another run holds this scope. Skipping is safe and lossless: progress
      // lives in the projection now, so the holder is continuing the very run
      // this tick would have joined.
      this.logger.log(
        `Taxonomy sync for connection ${connectionId} skipped: ${lockKey} already in progress`,
      );
      return {
        nextRunStartedAt: input.runStartedAt,
        upserted: 0,
        removed: 0,
        completed: false,
      };
    }

    try {
      return await this.runSync(connectionId, scope, openBrowse(), input);
    } finally {
      await this.syncLock.release(lockKey, lockToken);
    }
  }

  private async runSync(
    connectionId: string,
    scope: TaxonomyScope,
    browse: (parentId?: string) => Promise<DestinationCategoryUpsert[]>,
    input: TaxonomySyncInput,
  ): Promise<TaxonomySyncResult> {
    // Floored at 1, not merely defaulted. `??` passes a literal 0 through, and a
    // limit of 0 returns an empty frontier — which this loop reads as "run
    // complete" and would let authorise a sweep of a tree it never walked. The
    // worker handler already rejects a non-positive payload value, but this is a
    // public interface method and the failure mode is silent data loss.
    const pageLimit = Math.max(1, input.pageLimit ?? SYNC_PAGE_LIMIT_DEFAULT);
    const resumedAt = this.usableRunStartedAt(input.runStartedAt, connectionId);
    const runStartedAt = resumedAt ?? new Date();
    let upserted = 0;

    // The root level is synthetic — it owns no row, so nothing can record that
    // it was browsed. That is why a fresh run is distinguishable only by the
    // absent cursor, and why the roots are browsed here rather than derived.
    if (resumedAt === null) {
      upserted += await this.repository.upsertMany(scope, await browse(undefined), runStartedAt);
    }

    // The frontier is a QUERY now (#2061), not a list carried across ticks:
    // rows this run observed, that can expand, that it has not expanded yet.
    // Because expansion is recorded on the row, a node reachable from two
    // parents — or through a cycle — cannot re-enter it on a later page, which
    // is what makes termination inherent rather than guarded.
    const expandable = await this.repository.findExpandable(scope, runStartedAt, pageLimit);

    for (const parentId of expandable) {
      const children = await browse(parentId);
      upserted += await this.repository.upsertMany(scope, children, runStartedAt);
      // AFTER the upsert, never before: a crash in between must leave this node
      // unexpanded (retried next tick) rather than expanded-with-unstamped-
      // children, whose children the completing sweep would then delete.
      await this.repository.markExpanded(scope, [parentId], runStartedAt);
    }

    const completed = expandable.length === 0;
    let removed = 0;

    if (completed) {
      // An empty frontier is NOT sufficient authority to sweep. It also
      // describes a run whose rows are missing entirely — a resumed watermark
      // whose rows were deleted, or a root browse that returned nothing because
      // the platform hiccuped. Sweeping on that reading deletes the whole scope.
      const observed = await this.repository.countObserved(scope, runStartedAt);

      if (observed === 0) {
        this.logger.error(
          `Taxonomy run for connection ${connectionId} observed zero categories; ` +
            `skipping the staleness sweep so an empty or lost response cannot delete the scope. ` +
            `Restarting from the roots on the next run.`,
        );
        return { nextRunStartedAt: null, upserted, removed: 0, completed: true };
      }

      removed = await this.repository.deleteStaleBelow(scope, runStartedAt);

      this.logger.log(
        `destination.taxonomy.sync completed (connection=${connectionId}, ` +
          `scope=${this.describeScope(scope)}): observed=${observed}, removed=${removed}`,
      );
    }

    return {
      nextRunStartedAt: completed ? null : runStartedAt.toISOString(),
      upserted,
      removed,
      completed,
    };
  }

  /** Which row set this connection reads/writes. Memoised per connection. */
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
   * The owner value is DECLARED by the adapter — `TaxonomyBorrower` for a
   * borrower (Erli), `TaxonomyIdentityProvider` for an owner (Allegro) — and
   * resolved by the shared `resolveTaxonomyOwner` helper. It is never inferred
   * from `platformType`, which cannot express an axis a platform splits its
   * tree along (#2063).
   *
   * That helper returns `null` for an adapter declaring neither, rather than
   * throwing — resolution then falls through to the `ProductPublisher` probe,
   * and only the final throw below reports it (with a message naming the real
   * cause). The net effect is what matters: a marketplace cannot silently write
   * rows under a guessed owner, which would be a data migration to undo.
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
      // Shared with the scheduler's election so the two cannot disagree.
      const owningTaxonomy = resolveTaxonomyOwner(offerManager);

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

    // Distinguish "cannot browse at all" from "browses a tree but does not say
    // WHICH tree": the second is actionable (implement TaxonomyIdentityProvider
    // on the adapter, adding a TaxonomyOwnerValues entry once confirmed it is
    // one distinct tree), and reporting it as a missing capability would send
    // the reader looking in the wrong place.
    throw new TaxonomySourceUnavailableException(
      connectionId,
      offerManager && isCategoryBrowser(offerManager)
        ? 'the connection browses a marketplace taxonomy but declares no taxonomy identity — implement TaxonomyIdentityProvider on its adapter, adding a TaxonomyOwnerValues entry once confirmed it publishes one distinct tree'
        : 'no CategoryBrowser, TaxonomyBorrower, TaxonomyIdentityProvider, or ShopCategoryBrowser capability',
    );
  }

  private marketplaceBrowseFn(
    connectionId: string,
    adapter: OfferManagerPort,
  ): (parentId?: string) => Promise<DestinationCategoryUpsert[]> {
    if (!isCategoryBrowser(adapter)) {
      // Reachable for any connection that names a tree it cannot refresh. Today
      // that is a borrower with no catalogue credentials — `ErliOfferManagerAdapter`
      // assigns `fetchCategories` conditionally in its constructor (ADR-031) —
      // but since #2063 an OWNER declaring `TaxonomyIdentityProvider` without
      // `CategoryBrowser` lands here too, so the message leads with the general
      // cause and mentions the borrower case only as the likely instance.
      // Either way the tree's rows are still readable; only refresh is unavailable.
      throw new TaxonomySourceUnavailableException(
        connectionId,
        'connection names a taxonomy but cannot browse it (no CategoryBrowser capability — for a borrower, typically missing catalogue credentials)',
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
   * Resolve a stored run watermark, or `null` to start a fresh run.
   *
   * See `MAX_RUN_AGE_MS` for why this guard survives #2061 with a different
   * justification (freshness, no longer correctness) and a relaxed limit.
   */
  private usableRunStartedAt(stored: string | null, connectionId: string): Date | null {
    if (stored === null || stored.length === 0) {
      return null;
    }

    const startedAt = Date.parse(stored);
    if (Number.isNaN(startedAt)) {
      // Also the upgrade path from Wave 1: a stored JSON frontier does not parse
      // as a timestamp, so the first run after deploy simply starts fresh.
      this.logger.warn(
        `Unparseable taxonomy run watermark for connection ${connectionId}; restarting from the roots`,
      );
      return null;
    }

    const ageMs = Date.now() - startedAt;
    if (ageMs > MAX_RUN_AGE_MS) {
      this.logger.warn(
        `Discarding taxonomy run for connection ${connectionId}: started ${stored} ` +
          `(${Math.round(ageMs / 3_600_000)}h ago) is past the ${MAX_RUN_AGE_MS / 3_600_000}h freshness limit. ` +
          `Restarting so the published tree is not stale.`,
      );
      return null;
    }

    return new Date(startedAt);
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
