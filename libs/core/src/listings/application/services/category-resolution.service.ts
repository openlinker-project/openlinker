/**
 * Category Resolution Service
 *
 * Resolves the destination category for a listing via the provenance-aware
 * placement chain (ADR-023 §1), each step gated on a declared capability:
 * 1. Provision — mirror/create on the destination (gated on `CategoryProvisioner`,
 *    delivered by #1041; a no-op seam until then)
 * 2. Barcode — GTIN/EAN catalog auto-detect (`CategoryBarcodeMatcher`)
 * 3. Mapping — configured per-source-category → destination mapping
 * 4. Manual — returns null for the operator to choose
 *
 * Returns a neutral `{ destinationCategoryId, provenance, method }`; `provenance`
 * (owns/borrows/open) is derived from the destination adapter's capabilities,
 * never its `platformType`.
 *
 * `resolveCategoriesBatch` resolves N variants by EAN in one answer;
 * `resolveCategoriesStream` resolves the same N variants but emits each verdict
 * as it lands (#2207, epic #2205), degrading to the batch capability and then to
 * per-item `no-match` when the destination declares neither.
 * `assertStreamableConnection` exposes the connection gate on its own (#2209) so
 * a transport whose status is committed by its first byte can reject an unusable
 * connection before it writes one.
 *
 * @module libs/core/src/listings/application/services
 * @implements {ICategoryResolutionService}
 */

import { Injectable, Inject } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type {
  OfferManagerPort,
  EanCategoryMatchStreamCompletion,
  EanCategoryMatchStreamDoneEvent,
  EanCategoryMatchStreamEvent,
  EanCategoryMatchStreamOptions,
  EanMatchResult,
  TaxonomyOwner,
} from '@openlinker/core/listings';
import {
  isCategoryBarcodeMatcher,
  isCategoryBrowser,
  isCategoryParametersReader,
  isEanCategoryMatcher,
  isEanCategoryMatcherStreaming,
  isTaxonomyBorrower,
  isTaxonomyIdentityProvider,
} from '@openlinker/core/listings';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
  type AdapterMetadata,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { IMappingConfigService, MAPPING_CONFIG_SERVICE_TOKEN } from '@openlinker/core/mappings';
import type { ICategoryResolutionService } from '../interfaces/category-resolution.service.interface';
import type {
  BatchCategoryResolveInput,
  BatchCategoryResolveItem,
  CategoryProvenance,
  CategoryResolutionInput,
  CategoryResolutionResult,
} from '../types/category-resolution.types';

@Injectable()
export class CategoryResolutionService implements ICategoryResolutionService {
  private readonly logger = new Logger(CategoryResolutionService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(MAPPING_CONFIG_SERVICE_TOKEN)
    private readonly mappingConfig: IMappingConfigService
  ) {}

  async resolveCategory(input: CategoryResolutionInput): Promise<CategoryResolutionResult> {
    const { connectionId, barcode, sourceCategoryIds, borrowedTaxonomy, sourceConnectionId } = input;

    // `provenance` is populated from the resolved adapter on the barcode step.
    // On the mapping / manual paths it is now seeded from the caller-threaded
    // `borrowedTaxonomy` (#1045): a destination that borrows is — by definition —
    // a `borrows` destination, so its mapping-path result carries that provenance.
    // `owns` / `open` destinations still leave it null on the non-barcode paths
    // (no adapter resolved here — by design, no extra I/O).
    let provenance: CategoryProvenance | null = borrowedTaxonomy ? 'borrows' : null;

    // Step 1: Provision (open provenance). No-op seam — the `CategoryProvisioner`
    // capability is delivered by #1041; until then this always falls through.
    const provisioned = await this.tryProvision();
    if (provisioned) {
      this.logger.debug(
        `Category resolved via provision (connection=${connectionId}, categoryId=${provisioned})`
      );
      return { destinationCategoryId: provisioned, provenance: 'open', method: 'provision' };
    }

    // Step 2: Auto-detect via barcode
    if (barcode) {
      const autoDetected = await this.tryAutoDetect(connectionId, barcode);
      provenance = autoDetected.provenance;
      if (autoDetected.categoryId) {
        this.logger.debug(
          `Category resolved via auto_detect (connection=${connectionId}, barcode=${barcode}, categoryId=${autoDetected.categoryId})`
        );
        return {
          destinationCategoryId: autoDetected.categoryId,
          provenance,
          method: 'auto_detect',
        };
      }
    }

    // Step 3: Category mapping fallback
    if (sourceCategoryIds && sourceCategoryIds.length > 0) {
      const mapped = await this.tryCategoryMapping(connectionId, sourceCategoryIds, {
        borrowedTaxonomy,
        sourceConnectionId,
      });
      if (mapped) {
        this.logger.debug(
          `Category resolved via category_mapping (connection=${connectionId}, categoryId=${mapped})`
        );
        return { destinationCategoryId: mapped, provenance, method: 'category_mapping' };
      }
    }

    // Step 4: Manual pick
    this.logger.debug(`Category unresolved, manual pick required (connection=${connectionId})`);
    return { destinationCategoryId: null, provenance, method: 'manual' };
  }

  async resolveCategoriesBatch(
    connectionId: string,
    input: BatchCategoryResolveInput
  ): Promise<Map<string, EanMatchResult>> {
    // Resolving the OfferManager adapter validates the connection up front:
    // unknown/disabled connections surface as 404/409, and a non-marketplace
    // connection as 422 — same gate the single-resolve route relies on.
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );
    // A destination that can't batch-match EANs (it `borrows` its taxonomy, e.g.
    // Erli per ADR-025 §3 — reuses already-resolved Allegro ids, has no catalog
    // of its own) degrades to `no-match` for every variant rather than aborting
    // the whole batch. It resolves the category server-side at submit instead
    // (the wizard suppresses the pre-flight blocker for it). This mirrors the
    // single-resolve chain's graceful fall-through and the per-item no-throw
    // contract, and is gated on the declared capability, never `platformType`.
    // A destination with no catalogue of its own may still borrow one from a
    // connection that owns its taxonomy (#2210); only when neither exists does
    // the batch degrade to `no-match` for every variant, resolving the category
    // at build time instead (the wizard suppresses the pre-flight blocker then).
    const { matcher } = await this.resolveEanMatcher(connectionId, adapter);
    // The `isEanCategoryMatcher` narrowing is not redundant: a resolved matcher
    // may be streaming-ONLY, and this path has no way to consume that, so such
    // an owner degrades every variant to `no-match` even though it could have
    // answered. Unreachable today (Allegro declares both capabilities); the
    // streaming path is the one to use if that ever stops being true.
    if (matcher === null || !isEanCategoryMatcher(matcher)) {
      this.logger.debug(
        `No EAN matcher available; degrading ${input.items.length} variant(s) to no-match ` +
          `for manual category selection (connection=${connectionId})`
      );
      return new Map<string, EanMatchResult>(
        input.items.map((item) => [item.variantId, { kind: 'no-match' }])
      );
    }
    this.logger.debug(
      `Batch-resolving ${input.items.length} variant EAN(s) (connection=${connectionId})`
    );
    // EAN catalogue match stays the PRIMARY path - the adapter only needs
    // `{ variantId, ean }`; `sourceCategoryIds` is a core-owned fallback input.
    const eanResults = await matcher.resolveCategoriesForBatchByEan({
      items: input.items.map((item) => ({ variantId: item.variantId, ean: item.ean })),
    });

    const resolved = new Map<string, EanMatchResult>();
    for (const item of input.items) {
      resolved.set(
        item.variantId,
        await this.applyMappingFallback(
          connectionId,
          item,
          eanResults.get(item.variantId) ?? { kind: 'no-match' }
        )
      );
    }
    return resolved;
  }

  async assertStreamableConnection(connectionId: string): Promise<void> {
    // The gate *is* adapter resolution: `getCapabilityAdapter` raises the
    // unknown / disabled / non-marketplace errors a transport maps to
    // 404 / 409 / 422. No marketplace call happens here, which is the point -
    // a streaming caller can commit its status before spending quota.
    //
    // The resolved instance is deliberately discarded rather than returned:
    // `resolveCategoriesStream` builds its own, and handing this one out would
    // invite a caller to hold a handle whose credentials may have been rotated
    // by the time the stream reaches its last item.
    await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );
  }

  async *resolveCategoriesStream(
    connectionId: string,
    input: BatchCategoryResolveInput,
    options?: EanCategoryMatchStreamOptions
  ): AsyncGenerator<EanCategoryMatchStreamEvent> {
    const signal = options?.signal;
    let resolvedCount = 0;
    let unresolvedCount = 0;
    // Stays false until a matcher is resolved, so an early exit (already-aborted
    // signal, connection gate failure) never claims a catalogue was consulted.
    let catalogueLookupPerformed = false;
    const tally = (result: EanMatchResult): void => {
      if (result.kind === 'matched') {
        resolvedCount += 1;
        return;
      }
      unresolvedCount += 1;
    };
    const done = (
      completion: EanCategoryMatchStreamCompletion
    ): EanCategoryMatchStreamDoneEvent => ({
      kind: 'done',
      resolvedCount,
      unresolvedCount,
      completion,
      catalogueLookupPerformed,
    });
    // Every non-throwing exit reports the same way, so a path can never claim a
    // clean finish while the caller's signal cut it short.
    const settled = (): EanCategoryMatchStreamDoneEvent =>
      done(signal?.aborted ? 'aborted' : 'complete');

    try {
      // An already-aborted signal must not even resolve the adapter — connection
      // resolution can decrypt credentials and mint a token, which is exactly the
      // work the caller just told us to stop scheduling. The `aborted` completion
      // is what keeps this honest: a bare 0/0 tally is indistinguishable from a
      // healthy connection with nothing to do.
      if (signal?.aborted) {
        yield done('aborted');
        return;
      }

      // Same gate as `resolveCategoriesBatch`: unknown/disabled connections
      // surface as 404/409 and a non-marketplace connection as 422. It runs on the
      // first `next()` rather than at call time — a generator body is lazy.
      const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
        connectionId,
        'OfferManager'
      );
      const eanOnlyItems = input.items.map((item) => ({
        variantId: item.variantId,
        ean: item.ean,
      }));

      // Same borrowing rule as the batch path, so the wizard preview and the
      // offer build cannot disagree about a borrowing destination's category.
      const { matcher } = await this.resolveEanMatcher(connectionId, adapter);
      catalogueLookupPerformed = matcher !== null;

      if (matcher !== null && isEanCategoryMatcherStreaming(matcher)) {
        this.logger.debug(
          `Streaming ${input.items.length} variant EAN(s) (connection=${connectionId})`
        );
        const byVariantId = new Map(input.items.map((item) => [item.variantId, item]));
        const seen = new Set<string>();
        for await (const streamed of matcher.streamCategoriesForBatchByEan(
          { items: eanOnlyItems },
          signal ? { signal } : undefined
        )) {
          if (signal?.aborted) {
            break;
          }
          // The per-item invariant a consumer's progress denominator relies on is
          // one `result` per *input* item, so an adapter re-emitting a variant (a
          // retry wave inside the producer is a realistic source) or naming one
          // nobody asked about must not be passed upward - either would push the
          // tallies past the input size and a progress bar past 100%.
          if (seen.has(streamed.variantId)) {
            continue;
          }
          const item = byVariantId.get(streamed.variantId);
          if (!item) {
            this.logger.warn(
              `Adapter reported unknown variant ${streamed.variantId}; dropping the event ` +
                `(connection=${connectionId})`
            );
            continue;
          }
          seen.add(streamed.variantId);
          const result = await this.applyMappingFallback(connectionId, item, streamed.result);
          tally(result);
          yield { kind: 'result', variantId: streamed.variantId, result };
        }
        // A consumer's progress denominator is the input size, so an item the
        // adapter never reported would leave the bar short of complete forever.
        // Report it as unresolved rather than trusting the adapter's arithmetic.
        if (!signal?.aborted) {
          for (const item of input.items) {
            if (seen.has(item.variantId)) {
              continue;
            }
            const result = await this.applyMappingFallback(connectionId, item, {
              kind: 'no-match',
            });
            tally(result);
            yield { kind: 'result', variantId: item.variantId, result };
          }
        }
        yield settled();
        return;
      }

      if (matcher !== null && isEanCategoryMatcher(matcher)) {
        // Batch-only adapter: nothing is observable until the whole call returns,
        // so the operator sees the results arrive together. The step still
        // completes, which is the point of keeping the streaming capability a
        // sibling rather than a replacement (epic #2205 decision 2).
        this.logger.debug(
          `Adapter lacks EanCategoryMatcherStreaming; batch-resolving ${input.items.length} ` +
            `variant EAN(s) before emitting (connection=${connectionId})`
        );
        const eanResults = await matcher.resolveCategoriesForBatchByEan({ items: eanOnlyItems });
        for (const item of input.items) {
          if (signal?.aborted) {
            break;
          }
          const result = await this.applyMappingFallback(
            connectionId,
            item,
            eanResults.get(item.variantId) ?? { kind: 'no-match' }
          );
          tally(result);
          yield { kind: 'result', variantId: item.variantId, result };
        }
        yield settled();
        return;
      }

      // No matcher at all, neither the destination's own nor a borrowed one: the
      // mapping fallback is deliberately skipped here so the stream stays
      // byte-identical to what `resolveCategoriesBatch` returns for the same
      // destination (epic #2205 decision 4 - an immediate stream is a first-class
      // case, not a failure). `catalogueLookupPerformed` is what tells the
      // consumer these `no-match` results carry no information.
      this.logger.debug(
        `No EAN matcher available; streaming ${input.items.length} no-match result(s) ` +
          `for manual category selection (connection=${connectionId})`
      );
      for (const item of input.items) {
        const result: EanMatchResult = { kind: 'no-match' };
        tally(result);
        yield { kind: 'result', variantId: item.variantId, result };
      }
      yield settled();
    } catch (error) {
      // The terminal event is emitted BEFORE rethrowing, and the error is then
      // rethrown rather than being folded into the event. Both halves are needed
      // for different consumers: over the NDJSON transport (epic #2205 step 4)
      // the response status is already committed, so the only way a truncated
      // run is distinguishable from a clean one is a `done` line that says
      // `failed` - while an in-process caller needs the real error object for
      // its log and its retry decision, which no serializable field carries.
      // A consumer that stops iterating on the terminal event never observes the
      // rethrow, which is fine: it already learned the run ended badly.
      yield done('failed');
      throw error;
    }
  }

  /**
   * Decide which adapter performs the EAN catalogue lookup for a destination.
   *
   * A destination that owns a catalogue answers for itself. A destination that
   * BORROWS its taxonomy (ADR-025 §3: Erli accepts Allegro ids verbatim and
   * ships no catalogue) has nothing to ask, so the lookup is delegated to a
   * connection that OWNS that taxonomy and can match EANs - the same borrowing
   * principle #1045 already applies to configured category mappings, moved one
   * step earlier to the catalogue itself.
   *
   * Deliberately OPTIONAL. With no owner connection present the caller keeps
   * today's behaviour exactly (`no-match` per variant, category resolved at
   * build time from the operator's own mappings). This is not the rejected
   * ADR-031 option of *requiring* an Allegro seller connection - an Erli-only
   * operator is never asked to create one.
   *
   * Borrowing cannot use the destination's own Allegro application credentials
   * (#1382): probed live, an application token reaches every category endpoint
   * but is refused on the catalogue search with 403 even carrying
   * `allegro:api:sale:offers:read`. The search needs seller context, which only
   * a real connection has. See ADR-047's appendix.
   *
   * ISOLATION IS THE HARD REQUIREMENT HERE. This runs on a path whose whole
   * contract is "degrade to `no-match`, never throw", so no third party's
   * misconfiguration may reach the caller: the discovery listing is `lazy` (no
   * adapter is built while candidates are filtered), the destination's own
   * connection is dropped before any construction, and both the listing and the
   * one construction that survives the filter are caught. A candidate that
   * cannot be built is treated as "no owner", because the alternative - throwing
   * - turns an unrelated broken Allegro connection into a 500 on the batch route
   * and a `failed` stream, which is strictly worse than the pre-#2210 behaviour
   * this feature is supposed to be a free upgrade over.
   */
  private async resolveEanMatcher(
    connectionId: string,
    destination: OfferManagerPort
  ): Promise<{ matcher: OfferManagerPort | null; borrowedFrom: string | null }> {
    if (isEanCategoryMatcher(destination) || isEanCategoryMatcherStreaming(destination)) {
      return { matcher: destination, borrowedFrom: null };
    }
    if (!isTaxonomyBorrower(destination)) {
      return { matcher: null, borrowedFrom: null };
    }

    const owner = destination.getBorrowedTaxonomy();
    let candidates: Array<{
      connectionId: string;
      connection: Connection;
      adapter: OfferManagerPort;
      metadata: AdapterMetadata;
    }> = [];
    try {
      candidates = await this.integrationsService.listCapabilityAdapters<OfferManagerPort>({
        capability: 'OfferManager',
        lazy: true,
      });
    } catch (error) {
      // The listing itself aborts on ANY connection's adapter-key resolution
      // error, including one that has nothing to do with this destination.
      this.logger.warn(
        `Could not enumerate '${owner}' taxonomy owners for connection ${connectionId}; ` +
          `leaving the category to build-time mapping resolution: ${(error as Error).message}`
      );
      return { matcher: null, borrowedFrom: null };
    }

    // Manifest pre-filter: EAN matching is declared statically, so an adapter
    // that cannot answer is discarded WITHOUT being constructed. Together with
    // dropping the destination's own connection this keeps the cost at one
    // construction (the winner) instead of one per active OfferManager.
    const eligible = candidates
      .filter(({ connectionId: candidateId }) => candidateId !== connectionId)
      .filter(({ metadata }) => this.declaresEanMatching(metadata))
      // Oldest connection wins, ties broken by id. Matches the oldest-wins rule
      // `findBySourceCategory` already uses for borrowed-taxonomy mappings, so
      // the catalogue lookup and the mapping fallback can never disagree about
      // which owner they mean.
      .sort((a, b) => {
        const byAge = a.connection.createdAt.getTime() - b.connection.createdAt.getTime();
        return byAge !== 0 ? byAge : a.connectionId.localeCompare(b.connectionId);
      });

    // The taxonomy identity is per-CONNECTION (an Allegro sandbox connection
    // owns a different tree from a production one, #2063), so it can only be
    // read off a built adapter - which is why the loop constructs in the
    // deterministic order above and stops at the first owner, rather than
    // building every candidate to count them.
    for (const candidate of eligible) {
      const adapter = await this.buildOwnerCandidate(candidate, owner, connectionId);
      if (adapter === null) {
        continue;
      }
      if (eligible.length > 1) {
        this.logger.warn(
          `Ambiguous borrowed-taxonomy EAN matcher: ${eligible.length} connections declare ` +
            `EAN matching. Using the oldest that owns '${owner}' (${candidate.connectionId}) ` +
            `for connection ${connectionId}`
        );
      }
      this.logger.debug(
        `Borrowing the '${owner}' catalogue from connection ${candidate.connectionId} ` +
          `(connection=${connectionId})`
      );
      return { matcher: adapter, borrowedFrom: candidate.connectionId };
    }

    this.logger.debug(
      `No connection owns taxonomy '${owner}' with EAN matching; leaving the category to ` +
        `build-time mapping resolution (connection=${connectionId})`
    );
    return { matcher: null, borrowedFrom: null };
  }

  /** A manifest that declares neither EAN capability can never serve as an owner. */
  private declaresEanMatching(metadata: AdapterMetadata): boolean {
    const declared: readonly string[] = metadata.supportedCapabilities ?? [];
    return (
      declared.includes('EanCategoryMatcher') || declared.includes('EanCategoryMatcherStreaming')
    );
  }

  /**
   * Build one owner candidate and confirm it really owns `owner` and really
   * matches EANs, or report `null`.
   *
   * A construction failure (missing credentials, invalid config - the Allegro
   * factory raises those for a half-configured connection that is still
   * `active`) is logged and degraded rather than rethrown: the operator's OWN
   * destination is healthy, and an optional catalogue borrow must never be the
   * reason their resolve fails. The manifest gate is static, so the runtime
   * guards below are still required - a declared capability may be missing on
   * the instance (advertised-without-dispatch sub-capabilities are real).
   */
  private async buildOwnerCandidate(
    candidate: { connectionId: string; adapter: OfferManagerPort | Promise<OfferManagerPort> },
    owner: TaxonomyOwner,
    connectionId: string
  ): Promise<OfferManagerPort | null> {
    let adapter: OfferManagerPort;
    try {
      // A `lazy` entry's `adapter` is a memoized CONSTRUCTION PROMISE that the
      // listing types as the adapter itself (#1206), so it is normalised here
      // rather than trusted to be either shape.
      adapter = await Promise.resolve(candidate.adapter);
    } catch (error) {
      this.logger.warn(
        `Could not build taxonomy-owner candidate ${candidate.connectionId} while resolving ` +
          `an EAN matcher for connection ${connectionId}; skipping it: ${(error as Error).message}`
      );
      return null;
    }
    if (!isTaxonomyIdentityProvider(adapter) || adapter.getTaxonomyIdentity() !== owner) {
      return null;
    }
    if (!isEanCategoryMatcher(adapter) && !isEanCategoryMatcherStreaming(adapter)) {
      return null;
    }
    return adapter;
  }

  /**
   * #1522 — mapping fallback, shared by the batch and streaming paths so the
   * two can never disagree about a single item. When the EAN yields no
   * catalogue match (or the variant has no EAN) and the item supplies source
   * categories, consult the operator's configured per-source-category mapping —
   * the same mapping `OfferBuilderService` honours at offer-build time — so the
   * wizard preview agrees with the build. A hit resolves to a `matched` result
   * with no catalogue card (the offer self-links by barcode at build time).
   */

  private async applyMappingFallback(
    connectionId: string,
    item: BatchCategoryResolveItem,
    eanResult: EanMatchResult
  ): Promise<EanMatchResult> {
    if (
      (eanResult.kind === 'no-match' || eanResult.kind === 'no-ean') &&
      item.sourceCategoryIds &&
      item.sourceCategoryIds.length > 0
    ) {
      // Empty opts (no `sourceConnectionId`/`borrowedTaxonomy`) is safe today:
      // this runs only past an EAN-capability gate, and every current EAN
      // matcher (Allegro) *owns* its taxonomy, so `resolveDestinationCategory`
      // resolves entirely via its step-1 `findBySourceCategory` lookup, which
      // consults neither opt. The transport also has no `sourceConnectionId` to
      // carry. If a future destination is ever both an EAN matcher *and* a
      // borrows-taxonomy destination, this preview would need to thread
      // `sourceConnectionId`/`borrowedTaxonomy` here too, or it would silently
      // diverge from `OfferBuilderService.resolveCategory`.
      const mapped = await this.tryCategoryMapping(connectionId, item.sourceCategoryIds, {});
      if (mapped) {
        this.logger.debug(
          `Variant ${item.variantId} resolved via category_mapping (connection=${connectionId}, categoryId=${mapped})`
        );
        return {
          kind: 'matched',
          allegroCategoryId: mapped,
          productCardId: '',
          method: 'category_mapping',
        };
      }
    }
    return eanResult;
  }

  /**
   * Provision step (ADR-023 §1, step 1) — mirror/create the source category on
   * the destination. Gated on the `CategoryProvisioner` capability (ADR-024),
   * delivered by #1041; a no-op until then, so the chain always falls through
   * to the barcode step. #1041 resolves the destination adapter, narrows via
   * `isCategoryProvisioner`, calls `provisionCategory(...)`, and returns the
   * provisioned id (provenance `open`).
   */
  private tryProvision(): Promise<string | null> {
    // No-op seam: returns a resolved Promise so the async contract #1041 fills
    // is already in place at the call site (non-`async` avoids an empty-await lint).
    return Promise.resolve(null);
  }

  /**
   * Barcode step — resolve the destination adapter (capturing its provenance)
   * and, when it supports barcode matching, auto-detect the category.
   *
   * Returns the matched category id (or null) alongside the destination's
   * taxonomy provenance. On adapter-resolution failure the step degrades
   * gracefully (null id, null provenance) so the chain can still fall through
   * to mapping.
   */
  private async tryAutoDetect(
    connectionId: string,
    barcode: string
  ): Promise<{ categoryId: string | null; provenance: CategoryProvenance | null }> {
    try {
      const marketplace = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
        connectionId,
        'OfferManager'
      );
      const provenance = this.deriveProvenance(marketplace);
      if (!isCategoryBarcodeMatcher(marketplace)) {
        this.logger.debug(
          `Destination adapter does not support matchCategoryByBarcode (connection=${connectionId})`
        );
        return { categoryId: null, provenance };
      }
      return { categoryId: await marketplace.matchCategoryByBarcode(barcode), provenance };
    } catch (error) {
      this.logger.warn(
        `Auto-detect category failed (connection=${connectionId}): ${(error as Error).message}`
      );
      return { categoryId: null, provenance: null };
    }
  }

  /**
   * Derive how the destination relates to the taxonomy it resolves against,
   * from its declared capabilities (never `platformType`). A destination that
   * browses its own category tree / exposes per-category parameters `owns` the
   * taxonomy (Allegro); one that does neither `borrows` it (ERLI). `open`
   * (shop provisioning) is reachable once #1041 adds `CategoryProvisioner`.
   */
  private deriveProvenance(adapter: OfferManagerPort): CategoryProvenance {
    if (isCategoryBrowser(adapter) || isCategoryParametersReader(adapter)) {
      return 'owns';
    }
    return 'borrows';
  }

  private async tryCategoryMapping(
    connectionId: string,
    sourceCategoryIds: string[],
    opts: { borrowedTaxonomy?: string; sourceConnectionId?: string }
  ): Promise<string | null> {
    // Pass the opts object only when it carries something — keeps the call shape
    // minimal (and the legacy 2-arg contract intact) for owns/open destinations
    // that thread neither a borrowed taxonomy nor a source connection.
    const hasOpts = opts.borrowedTaxonomy != null || opts.sourceConnectionId != null;
    for (const categoryId of sourceCategoryIds) {
      const resolved = hasOpts
        ? await this.mappingConfig.resolveDestinationCategory(connectionId, categoryId, opts)
        : await this.mappingConfig.resolveDestinationCategory(connectionId, categoryId);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }
}
