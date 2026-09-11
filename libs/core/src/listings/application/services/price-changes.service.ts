/**
 * Price Changes Service (#3145, ADR-072)
 *
 * The single application-layer owner of the review-queue read + the
 * accept/ignore/edit/bulk-accept/unresolve/refresh write paths. Enriches
 * `PriceChangeEpisode` rows with product/connection identity so the API
 * controller stays a thin pass-through, and enqueues
 * `pricing.propagateToMarketplaces` for every accepted/edited episode
 * (#3144 owns the actual publish).
 *
 * **This service never writes `Connection.config`** (#3162 review —
 * BLOCKING in an earlier revision): it is the only core service that used
 * to write a connection's config directly through `ConnectionPort`, going
 * around `IConnectionService`'s validation
 * (`validateStockAndPricingConfig`/`validateConfigShape`) and its
 * concurrency-safety net. `IConnectionService` is an APP-LAYER construct
 * (`apps/api/src/integrations`), so a CORE service literally cannot depend
 * on it without inverting the core→app dependency direction. `accept`/
 * `edit`/`bulkAccept` therefore only REPORT which (destination, source)
 * pair(s) requested the `automatic` opt-in
 * (`PriceChangeResolutionResult.optInPair` / `BulkAcceptResult.optInPairs`)
 * — the HTTP controller, which already lives in `apps/api`, performs the
 * actual mutation via `IConnectionService`, locked per connection.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IPriceChangesService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  CONNECTION_PORT_TOKEN,
  type ConnectionPort,
  type Connection,
  readPricingRuleForSource,
} from '@openlinker/core/identifier-mapping';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import { JOB_ENQUEUE_TOKEN, type JobEnqueuePort } from '@openlinker/core/sync';
import type { ProductVariant } from '@openlinker/core/products';
import type { PriceChangeEpisode } from '../../domain/entities/price-change-episode.entity';
import { PriceChangeEpisodeRepositoryPort } from '../../domain/ports/price-change-episode-repository.port';
import { PriceChangeAutoAppliedLogRepositoryPort } from '../../domain/ports/price-change-auto-applied-log-repository.port';
import { BulkListingBatchRepositoryPort } from '../../domain/ports/bulk-listing-batch-repository.port';
import type { PriceChangeEpisodeFilters } from '../../domain/types/price-change-episode.types';
import { readConnectionCurrency } from '../../domain/types/price-change-block.types';
import {
  BULK_BATCH_STATUS,
  type BulkBatchStatus,
} from '../../domain/types/bulk-listing-batch.types';
import type { BulkListingBatch } from '../../domain/entities/bulk-listing-batch.entity';
import { PriceChangeEpisodeNotFoundException } from '../../domain/exceptions/price-change-episode-not-found.exception';
import { PriceChangeEpisodeAlreadyResolvedException } from '../../domain/exceptions/price-change-episode-already-resolved.exception';
import { PriceChangeEpisodeStaleException } from '../../domain/exceptions/price-change-episode-stale.exception';
import { PriceChangeEpisodeBlockedException } from '../../domain/exceptions/price-change-episode-blocked.exception';
import {
  PRICE_CHANGE_EPISODE_REPOSITORY_TOKEN,
  PRICE_CHANGE_AUTO_APPLIED_LOG_REPOSITORY_TOKEN,
  BULK_LISTING_BATCH_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type {
  AcceptPriceChangeInput,
  BulkAcceptItemInput,
  BulkAcceptResult,
  EditPriceChangeInput,
  IPriceChangesService,
  PriceChangeConnectionPair,
  PriceChangeResolutionResult,
} from './price-changes.service.interface';
import type {
  PriceChangeQueueItem,
  PriceChangeQueuePage,
} from '../types/price-change-queue-item.types';
import type { PriceChangeAutoAppliedView } from '../types/price-change-auto-applied-view.types';

const JOB_TYPE = 'pricing.propagateToMarketplaces';

/** Default/max page size for the review-queue list read (#3162 review). */
const DEFAULT_PRICE_CHANGE_PAGE_SIZE = 50;
const MAX_PRICE_CHANGE_PAGE_SIZE = 200;

/**
 * The idempotency key's time bucket (#3162 review — a dead-lettered episode
 * could never be re-accepted at the same price: `sync_jobs.idempotencyKey`
 * is globally unique and TTL-less, so once a job exhausts the retry ladder
 * the identical key is minted forever after and every retry silently no-ops
 * via `isExisting: true`). Folding in an hourly bucket keeps a rapid
 * double-click deduped within the SAME bucket (the genuine double-submit
 * protection #2621's design note is about) while giving a genuinely stuck
 * episode a fresh key within at most an hour — without a schema change or a
 * client-supplied nonce. This does not make the key amount-derived in the
 * sense #2285 forbids (a DIFFERENT price already got a different key); it
 * only bounds how long the SAME price can be wedged behind one dead job.
 */
const IDEMPOTENCY_KEY_BUCKET_MS = 60 * 60 * 1000;

@Injectable()
export class PriceChangesService implements IPriceChangesService {
  private readonly logger = new Logger(PriceChangesService.name);

  constructor(
    @Inject(PRICE_CHANGE_EPISODE_REPOSITORY_TOKEN)
    private readonly episodes: PriceChangeEpisodeRepositoryPort,
    @Inject(PRICE_CHANGE_AUTO_APPLIED_LOG_REPOSITORY_TOKEN)
    private readonly autoAppliedLog: PriceChangeAutoAppliedLogRepositoryPort,
    @Inject(BULK_LISTING_BATCH_REPOSITORY_TOKEN)
    private readonly bulkBatches: BulkListingBatchRepositoryPort,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  async listOpen(filters: PriceChangeEpisodeFilters): Promise<PriceChangeQueuePage> {
    const limit = this.resolvePageSize(filters.limit);
    const offset = filters.offset && filters.offset > 0 ? filters.offset : 0;
    const boundedFilters: PriceChangeEpisodeFilters = {
      ...filters,
      limit,
      offset,
      // Recently-`ignored` episodes are surfaced so the review queue's
      // row-level Undo affordance is reachable at all (#3162 review) — a
      // listed item's `resolution` was otherwise ALWAYS `null`, because
      // `findOpen` excluded every resolved row unconditionally.
      includeRecentlyResolved: true,
    };

    const episodes = filters.destinationConnectionId
      ? await this.episodes.findOpenForConnection(filters.destinationConnectionId, boundedFilters)
      : await this.episodes.findOpenAll(boundedFilters);

    // The accurate total for the SAME filters (never derived from
    // `episodes.length`, which is one bounded page) — countOpen stays
    // strictly "open" (never includes a recently-ignored row), which is the
    // correct semantics for a badge/tab counter.
    const total = await this.episodes.countOpen(filters);

    const variantIds = Array.from(new Set(episodes.map((e) => e.productVariantId)));
    const variants = await this.productsService.getVariantsByIds(variantIds);
    const variantsById = new Map(variants.map((v) => [v.id, v]));

    const staleVariantIds = new Set(
      variants.filter((v) => v.isStale === true).map((v) => v.id)
    );
    const visible = episodes.filter((e) => !staleVariantIds.has(e.productVariantId));
    const hiddenStaleCount = episodes.length - visible.length;

    const productIds = Array.from(
      new Set(
        visible
          .map((e) => variantsById.get(e.productVariantId)?.productId)
          .filter((id): id is string => !!id)
      )
    );
    const products = await this.productsService.getProductsByIds(productIds);
    const productsById = new Map(products.map((p) => [p.id, p]));

    const connectionIds = Array.from(
      new Set(visible.flatMap((e) => [e.sourceConnectionId, e.destinationConnectionId]))
    );
    const connectionsById = await this.fetchConnections(connectionIds);

    const items = visible.map((episode) =>
      this.toQueueItem(episode, variantsById, productsById, connectionsById)
    );

    return { items, hiddenStaleCount, total };
  }

  async countOpen(filters: PriceChangeEpisodeFilters): Promise<number> {
    return this.episodes.countOpen(filters);
  }

  async countOpenBySource(destinationConnectionId: string): Promise<ReadonlyMap<string, number>> {
    return this.episodes.countOpenBySource(destinationConnectionId);
  }

  async listOpenDestinationConnectionIds(sourceConnectionId: string): Promise<readonly string[]> {
    return this.episodes.listOpenDestinationConnectionIds(sourceConnectionId);
  }

  async accept(
    episodeId: string,
    input: AcceptPriceChangeInput
  ): Promise<PriceChangeResolutionResult> {
    const episode = await this.loadActionable(episodeId, input.expectedVersion);
    await this.enqueuePublish(episode, {
      amount: episode.computedNewAmount,
      manualPriceOverride: false,
      resolvedByUserId: input.resolvedByUserId,
    });
    return this.resolutionResult(episode, input.optInAutomatic);
  }

  async edit(
    episodeId: string,
    input: EditPriceChangeInput
  ): Promise<PriceChangeResolutionResult> {
    const episode = await this.loadActionable(episodeId, input.expectedVersion);
    await this.enqueuePublish(episode, {
      amount: input.manualPriceOverride,
      manualPriceOverride: true,
      resolvedByUserId: input.resolvedByUserId,
    });
    return this.resolutionResult(episode, input.optInAutomatic);
  }

  async ignore(episodeId: string, resolvedByUserId: string | null): Promise<void> {
    const episode = await this.episodes.findById(episodeId);
    if (!episode) {
      throw new PriceChangeEpisodeNotFoundException(episodeId);
    }
    if (!episode.isOpen()) {
      throw new PriceChangeEpisodeAlreadyResolvedException(episodeId);
    }
    await this.episodes.resolve(episodeId, 'ignored', resolvedByUserId, null, new Date());
  }

  async unresolve(episodeId: string): Promise<void> {
    // `reopenIgnored` itself raises `PriceChangeEpisodeSupersededError` when
    // a rival episode has since opened for the same key (the repository's
    // own `NOT EXISTS` guard / residual-race `catch`) — that error is
    // intentionally left to propagate to the controller, which maps it to
    // a 409 alongside the other resolution-conflict exceptions.
    const reopened = await this.episodes.reopenIgnored(episodeId);
    if (!reopened) {
      const episode = await this.episodes.findById(episodeId);
      if (!episode) {
        throw new PriceChangeEpisodeNotFoundException(episodeId);
      }
      throw new PriceChangeEpisodeAlreadyResolvedException(episodeId);
    }
  }

  async refresh(episodeId: string): Promise<PriceChangeQueueItem> {
    const episode = await this.episodes.acknowledgeRefresh(episodeId);
    if (!episode) {
      const existing = await this.episodes.findById(episodeId);
      if (!existing) {
        throw new PriceChangeEpisodeNotFoundException(episodeId);
      }
      // Exists but not open (already resolved) — acknowledging a refresh on
      // a resolved episode is meaningless; report it the same way every
      // other resolution-conflict path does.
      throw new PriceChangeEpisodeAlreadyResolvedException(episodeId);
    }

    const variants = await this.productsService.getVariantsByIds([episode.productVariantId]);
    const variantsById = new Map(variants.map((v) => [v.id, v]));
    const productIds = variants.map((v) => v.productId).filter((id): id is string => !!id);
    const products = await this.productsService.getProductsByIds(productIds);
    const productsById = new Map(products.map((p) => [p.id, p]));
    const connectionsById = await this.fetchConnections([
      episode.sourceConnectionId,
      episode.destinationConnectionId,
    ]);

    return this.toQueueItem(episode, variantsById, productsById, connectionsById);
  }

  async bulkAccept(
    items: BulkAcceptItemInput[],
    resolvedByUserId: string | null
  ): Promise<BulkAcceptResult> {
    // Batched load (#3162 review — one round trip rather than N sequential
    // `findById` calls) plus the SAME not-found/already-resolved/blocked/
    // stale checks the single-item path applies (`loadActionable`), so a
    // bulk submit cannot silently publish a price the operator never
    // reviewed (previously the staleness guard was skipped entirely on this
    // path).
    const uniqueIds = Array.from(new Set(items.map((item) => item.id)));
    const found = await this.episodes.findByIds(uniqueIds);
    const foundById = new Map(found.map((episode) => [episode.id, episode]));

    const episodesToApply: { episode: PriceChangeEpisode; item: BulkAcceptItemInput }[] = [];
    for (const item of items) {
      const episode = foundById.get(item.id);
      if (!episode) {
        throw new PriceChangeEpisodeNotFoundException(item.id);
      }
      this.assertActionable(episode, item.expectedVersion);
      episodesToApply.push({ episode, item });
    }

    // `connectionId` on the reused batch row is the FIRST item's destination —
    // the row spans several destinations by design (the mockup's per-connection
    // progress lanes), and this field is never read back for gating on this
    // path (#3144's review). Kept rather than a synthetic id so a batch is
    // still traceable to a real connection at a glance.
    const batch = await this.bulkBatches.create({
      connectionId: episodesToApply[0]?.episode.destinationConnectionId ?? '',
      initiatedBy: resolvedByUserId ?? 'unknown',
      totalCount: episodesToApply.length,
      sharedConfig: { kind: 'price-change' },
    });

    // Fan-out enqueue. On a mid-fan-out failure the batch is reconciled so
    // it can still reach a terminal status (the #1741/`BulkListingSubmitService`
    // partial-submit-atomicity pattern, documented on
    // `BulkListingBatchRepositoryPort.updateTotalCount`) — without this a
    // batch whose `totalCount` never matches the number of children that
    // actually reached the stream can never satisfy the #737 counter gate
    // (`succeededCount + failedCount === totalCount`) and lingers in
    // `pending`/`running` forever.
    const jobIds: string[] = [];
    const optInPairs = new Map<string, PriceChangeConnectionPair>();
    try {
      for (const { episode, item } of episodesToApply) {
        const result = await this.enqueuePublish(episode, {
          amount: episode.computedNewAmount,
          manualPriceOverride: false,
          resolvedByUserId,
          batchId: batch.id,
        });
        jobIds.push(result.jobId);
        if (item.optInAutomatic) {
          this.addOptInPair(optInPairs, episode);
        }
      }
    } catch (error) {
      const enqueued = jobIds.length;
      this.logger.error(
        `Price-change bulk batch ${batch.id} enqueue failed after ${enqueued}/${episodesToApply.length} jobs: ${(error as Error).message}`,
        (error as Error).stack
      );
      try {
        if (enqueued > 0) {
          const reconciled = await this.bulkBatches.updateTotalCount(batch.id, enqueued);
          const nextStatus = this.isBatchFinished(reconciled)
            ? this.deriveTerminalStatus(reconciled)
            : BULK_BATCH_STATUS.Running;
          await this.bulkBatches.updateStatus(batch.id, nextStatus);
        } else {
          await this.bulkBatches.updateStatus(batch.id, BULK_BATCH_STATUS.Failed);
        }
      } catch (reconcileError) {
        this.logger.error(
          `Price-change bulk batch ${batch.id} reconciliation also failed: ${(reconcileError as Error).message}`,
          (reconcileError as Error).stack
        );
      }
      throw error;
    }

    // Every child reached the stream — advance to 'running' (#3162 review:
    // this batch previously stayed 'pending' for its whole life, since only
    // the terminal-status write existed on this path). The worker handler
    // (#3144/#737) derives the terminal status from per-job counters via
    // `BulkListingProgressService.advanceBatchStatus`.
    await this.bulkBatches.updateStatus(batch.id, BULK_BATCH_STATUS.Running);

    return {
      batchId: batch.id,
      totalCount: episodesToApply.length,
      optInPairs: Array.from(optInPairs.values()),
    };
  }

  async listAutoApplied(limit: number): Promise<readonly PriceChangeAutoAppliedView[]> {
    const entries = await this.autoAppliedLog.findRecent(limit);
    if (entries.length === 0) return [];

    const variantIds = Array.from(new Set(entries.map((e) => e.productVariantId)));
    const variants = await this.productsService.getVariantsByIds(variantIds);
    const variantsById = new Map(variants.map((v) => [v.id, v]));

    const productIds = Array.from(
      new Set(variants.map((v) => v.productId).filter((id): id is string => !!id))
    );
    const products = await this.productsService.getProductsByIds(productIds);
    const productsById = new Map(products.map((p) => [p.id, p]));

    return entries.map((entry) => {
      const variant = variantsById.get(entry.productVariantId);
      const product = variant ? productsById.get(variant.productId) : undefined;
      return {
        id: entry.id,
        productVariantId: entry.productVariantId,
        // Absence is a fact for the FE to render, not a core-owned sentence
        // (#3168 review — operator copy belongs to the frontend and must
        // pass `check-ui-vocabulary`, which a backend string never enters).
        // `null` covers both "the variant was never found" (variant and
        // product both unresolved) and "the variant resolved but its
        // product did not" — the FE can tell the two apart itself by
        // checking `variantLabel`/`sku` alongside `productName`.
        productName: product?.name ?? null,
        variantLabel: this.variantLabel(variant),
        sku: variant?.sku ?? null,
        destinationConnectionId: entry.destinationConnectionId,
        sourceConnectionId: entry.sourceConnectionId,
        oldAmount: entry.oldAmount,
        newAmount: entry.newAmount,
        currency: entry.currency,
        appliedAt: entry.appliedAt,
      };
    });
  }

  /** Loads an episode and applies the shared not-found/already-resolved/blocked/stale checks. */
  private async loadActionable(
    episodeId: string,
    expectedVersion?: string
  ): Promise<PriceChangeEpisode> {
    const episode = await this.episodes.findById(episodeId);
    if (!episode) {
      throw new PriceChangeEpisodeNotFoundException(episodeId);
    }
    this.assertActionable(episode, expectedVersion);
    return episode;
  }

  /** The not-found-independent half of `loadActionable`, reused by the batched bulk path. */
  private assertActionable(episode: PriceChangeEpisode, expectedVersion?: string): void {
    if (!episode.isOpen()) {
      throw new PriceChangeEpisodeAlreadyResolvedException(episode.id);
    }
    if (episode.blockReason) {
      throw new PriceChangeEpisodeBlockedException(episode.id, episode.blockReason);
    }
    if (expectedVersion !== undefined) {
      const currentVersion = this.versionOf(episode);
      if (currentVersion !== expectedVersion) {
        throw new PriceChangeEpisodeStaleException(episode.id, expectedVersion, currentVersion);
      }
    }
  }

  private versionOf(episode: PriceChangeEpisode): string {
    return (episode.refreshedAt ?? episode.detectedAt).toISOString();
  }

  private resolutionResult(
    episode: PriceChangeEpisode,
    optInAutomatic?: boolean
  ): PriceChangeResolutionResult {
    if (!optInAutomatic) {
      return {};
    }
    return {
      optInPair: {
        destinationConnectionId: episode.destinationConnectionId,
        sourceConnectionId: episode.sourceConnectionId,
      },
    };
  }

  private addOptInPair(
    pairs: Map<string, PriceChangeConnectionPair>,
    episode: PriceChangeEpisode
  ): void {
    const key = `${episode.destinationConnectionId}:${episode.sourceConnectionId}`;
    pairs.set(key, {
      destinationConnectionId: episode.destinationConnectionId,
      sourceConnectionId: episode.sourceConnectionId,
    });
  }

  private resolvePageSize(requested: number | undefined): number {
    if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
      return DEFAULT_PRICE_CHANGE_PAGE_SIZE;
    }
    return Math.min(requested, MAX_PRICE_CHANGE_PAGE_SIZE);
  }

  /**
   * True once every child of the batch has terminated
   * (`succeededCount + failedCount === totalCount`) — the #737 counter gate,
   * mirroring `BulkListingSubmitService`'s private helper of the same name.
   */
  private isBatchFinished(batch: BulkListingBatch): boolean {
    return batch.succeededCount + batch.failedCount === batch.totalCount;
  }

  /**
   * Derive the terminal batch status from its post-reconcile counters —
   * same rule as `BulkListingProgressService`: all-succeeded ⇒ completed,
   * all-failed ⇒ failed, mixed ⇒ partially-failed. Call only when
   * {@link isBatchFinished} holds.
   */
  private deriveTerminalStatus(batch: BulkListingBatch): BulkBatchStatus {
    if (batch.failedCount === 0) return BULK_BATCH_STATUS.Completed;
    if (batch.succeededCount === 0) return BULK_BATCH_STATUS.Failed;
    return BULK_BATCH_STATUS.PartiallyFailed;
  }

  private async enqueuePublish(
    episode: PriceChangeEpisode,
    options: {
      amount: number;
      manualPriceOverride: boolean;
      resolvedByUserId: string | null;
      batchId?: string;
    }
  ): Promise<{ jobId: string; isExisting: boolean }> {
    // See `IDEMPOTENCY_KEY_BUCKET_MS` — an hourly bucket keeps a rapid
    // double-click deduped while letting a genuinely dead-lettered episode
    // become retryable within an hour rather than being wedged forever.
    const bucket = Math.floor(Date.now() / IDEMPOTENCY_KEY_BUCKET_MS);
    const result = await this.jobEnqueue.enqueueJob({
      jobType: JOB_TYPE,
      connectionId: episode.destinationConnectionId,
      idempotencyKey: `pricing:episode:${episode.id}:${options.batchId ?? 'single'}:${options.amount}:${bucket}`,
      payload: {
        productVariantId: episode.productVariantId,
        destinationConnectionId: episode.destinationConnectionId,
        sourceConnectionId: episode.sourceConnectionId,
        amount: options.amount,
        currency: episode.sourceCurrency,
        automatic: false,
        episodeId: episode.id,
        manualPriceOverride: options.manualPriceOverride,
        resolvedByUserId: options.resolvedByUserId ?? undefined,
        batchId: options.batchId,
      },
    });
    if (result.isExisting) {
      this.logger.warn(
        `[price-changes] enqueue for episode ${episode.id} matched an already-queued job within the current hour bucket (jobId=${result.jobId}) — treated as an idempotent no-op`
      );
    }
    return result;
  }

  private async fetchConnections(ids: string[]): Promise<Map<string, Connection>> {
    if (ids.length === 0) {
      return new Map();
    }
    // Batched (#3162 review — this previously issued one `connections.get`
    // round trip per distinct id, sequentially, inside the loop; #2083's
    // rule is a batched read ONCE, before the per-row loop). The connection
    // catalogue is small relative to the episode set, so listing everything
    // and filtering client-side is cheap and avoids widening `ConnectionPort`
    // with an `ids` filter for this one caller.
    const idSet = new Set(ids);
    const all = await this.connections.list();
    return new Map(all.filter((c) => idSet.has(c.id)).map((c) => [c.id, c]));
  }

  private toQueueItem(
    episode: PriceChangeEpisode,
    variantsById: Map<string, ProductVariant>,
    productsById: Map<string, { id: string; name: string }>,
    connectionsById: Map<string, Connection>
  ): PriceChangeQueueItem {
    const variant = variantsById.get(episode.productVariantId);
    const product = variant ? productsById.get(variant.productId) : undefined;
    const sourceConnection = connectionsById.get(episode.sourceConnectionId);
    const destinationConnection = connectionsById.get(episode.destinationConnectionId);
    const rule = destinationConnection
      ? readPricingRuleForSource(destinationConnection.config, episode.sourceConnectionId)
      : null;

    return {
      id: episode.id,
      productVariantId: episode.productVariantId,
      productName: product?.name ?? 'Unknown product',
      variantLabel: this.variantLabel(variant),
      sku: variant?.sku ?? null,
      sourceConnectionId: episode.sourceConnectionId,
      sourceLabel: sourceConnection?.name ?? 'Unknown connection',
      sourceOldAmount: episode.sourceOldAmount,
      sourceNewAmount: episode.sourceNewAmount,
      sourceCurrency: episode.sourceCurrency,
      destinationConnectionId: episode.destinationConnectionId,
      destinationLabel: destinationConnection?.name ?? 'Unknown connection',
      destinationCurrency: destinationConnection
        ? readConnectionCurrency(destinationConnection.config)
        : null,
      computedOldAmount: episode.computedOldAmount,
      computedNewAmount: episode.computedNewAmount,
      deltaPct: episode.deltaPct(),
      isSteep: episode.isSteep(),
      ruleSummary: {
        type: rule?.type ?? 'passthrough',
        percent: rule?.percent ?? 0,
        rounding: rule?.rounding ?? 'none',
      },
      blockReason: episode.blockReason,
      needsRefresh: episode.refreshedAt !== null,
      version: this.versionOf(episode),
      manualPriceOverride: episode.manualPriceOverride,
      resolution: episode.resolution,
      resolvedAt: episode.resolvedAt ? episode.resolvedAt.toISOString() : null,
      resolvedByUserId: episode.resolvedByUserId,
      detectedAt: episode.detectedAt.toISOString(),
    };
  }

  private variantLabel(variant: ProductVariant | undefined): string | null {
    if (!variant || !variant.attributes) {
      return null;
    }
    const values = Object.values(variant.attributes).filter((v) => v.length > 0);
    return values.length > 0 ? values.join(' / ') : null;
  }
}
