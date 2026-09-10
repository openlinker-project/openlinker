/**
 * Price Change Apply Handler (#3144, ADR-072)
 *
 * Handles `pricing.propagateToMarketplaces` — the terminal write for a single
 * price change, whether it arrived via an accepted/edited review-queue
 * episode or directly from an `automatic`-mode detection (#3143).
 *
 * Follows ADR-007's status/outcome split (ADR-072 decision 8): a
 * DETERMINISTIC block (the episode's own `blockReason`, re-checked here as a
 * defensive belt-and-braces — the detection service never enqueues a blocked
 * pair, and #3145's accept endpoint must refuse to enqueue one either) is a
 * terminal `business_failure` on the SAME attempt, never a throw — a
 * currency mismatch cannot be fixed by retrying. A transient marketplace/shop
 * API error throws `SyncJobExecutionError` and lets ADR-050's lane/retry
 * ladder handle it.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { CapabilityNotSupportedException } from '@openlinker/core/integrations';
import {
  IInventoryQueryService,
  INVENTORY_QUERY_SERVICE_TOKEN,
} from '@openlinker/core/inventory';
import type { OfferManagerPort, ShopProductManagerPort } from '@openlinker/core/listings';
import {
  isOfferFieldUpdater,
  OFFER_MAPPINGS_SERVICE_TOKEN,
  PRODUCT_PUBLISH_BUILDER_SERVICE_TOKEN,
  PRICE_CHANGE_EPISODE_REPOSITORY_TOKEN,
  PRICE_CHANGE_AUTO_APPLIED_LOG_REPOSITORY_TOKEN,
  BULK_LISTING_PROGRESS_SERVICE_TOKEN,
  PriceChangeEpisodeRepositoryPort,
  PriceChangeAutoAppliedLogRepositoryPort,
  IOfferMappingsService,
  IProductPublishBuilderService,
  IBulkListingProgressService,
} from '@openlinker/core/listings';

type SyncJob = SyncJobEntity;

/**
 * Local payload shape (the `InventoryPropagateToMarketplacesPayload`
 * precedent) — never shared, since the only producer is the detection
 * service/API, both of which build the literal directly.
 */
interface PriceChangeApplyPayload {
  productVariantId: string;
  destinationConnectionId: string;
  sourceConnectionId: string;
  amount: number;
  currency: string;
  automatic: boolean;
  /** Present for an accept/edit/bulk-accept from the review queue (#3145). */
  episodeId?: string;
  /** Whether the amount above is an operator-pinned override, not the rule's. */
  manualPriceOverride?: boolean;
  resolvedByUserId?: string;
  /** Present when part of a bulk-accept wave (#3145/#3148). */
  batchId?: string;
}

@Injectable()
export class PriceChangeApplyHandler implements SyncJobHandler {
  private readonly logger = new Logger(PriceChangeApplyHandler.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(OFFER_MAPPINGS_SERVICE_TOKEN)
    private readonly offerMappings: IOfferMappingsService,
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventoryQuery: IInventoryQueryService,
    @Inject(PRODUCT_PUBLISH_BUILDER_SERVICE_TOKEN)
    private readonly productPublishBuilder: IProductPublishBuilderService,
    @Inject(PRICE_CHANGE_EPISODE_REPOSITORY_TOKEN)
    private readonly episodes: PriceChangeEpisodeRepositoryPort,
    @Inject(PRICE_CHANGE_AUTO_APPLIED_LOG_REPOSITORY_TOKEN)
    private readonly autoAppliedLog: PriceChangeAutoAppliedLogRepositoryPort,
    @Inject(BULK_LISTING_PROGRESS_SERVICE_TOKEN)
    private readonly bulkProgress: IBulkListingProgressService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing pricing.propagateToMarketplaces job ${job.id} for connection ${job.connectionId} ` +
        `(variant=${payload.productVariantId}, amount=${payload.amount} ${payload.currency}, automatic=${payload.automatic})`
    );

    // Defensive re-check (ADR-072 decision 8): a currency-mismatch block must
    // never retry 10x before dead-lettering — it can never succeed.
    let previousOldAmount: number | undefined;
    if (payload.episodeId) {
      const episode = await this.episodes.findById(payload.episodeId);
      if (!episode) {
        throw new SyncJobExecutionError(
          `Price-change episode not found: ${payload.episodeId}`,
          job.id,
          job.jobType,
          job.connectionId
        );
      }
      if (episode.blockReason) {
        this.logger.warn(
          `[price-change-apply] episode ${payload.episodeId} carries blockReason=${episode.blockReason}; refusing as a terminal business failure`
        );
        await this.advanceBulkProgress(payload, 'failed');
        return { outcome: 'business_failure' };
      }
      previousOldAmount = episode.sourceOldAmount;
    }

    try {
      await this.publishPrice(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Price propagation failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }

    const appliedAt = new Date();
    if (payload.episodeId) {
      await this.episodes.resolve(
        payload.episodeId,
        payload.manualPriceOverride ? 'accepted-custom' : 'accepted',
        payload.resolvedByUserId ?? null,
        payload.manualPriceOverride ? payload.amount : null,
        appliedAt
      );
    } else {
      // Automatic path — no episode was ever opened, so this log is the only
      // trace of the decision (#3143's detection service enqueues this job
      // directly for an `automatic`-mode pair, ADR-072 decision 3).
      await this.autoAppliedLog.record({
        productVariantId: payload.productVariantId,
        destinationConnectionId: payload.destinationConnectionId,
        sourceConnectionId: payload.sourceConnectionId,
        oldAmount: previousOldAmount ?? payload.amount,
        newAmount: payload.amount,
        currency: payload.currency,
        appliedAt,
      });
    }

    await this.advanceBulkProgress(payload, 'succeeded');

    return { outcome: 'ok' };
  }

  /**
   * Publishes the amount via whichever capability the destination supports —
   * `OfferFieldUpdater.updateOfferFields` for a marketplace, or a
   * `ProductPublisher` re-publish for a shop (#3144's proposed solution).
   */
  private async publishPrice(payload: PriceChangeApplyPayload): Promise<void> {
    let marketplaceAdapter: OfferManagerPort | null = null;
    try {
      marketplaceAdapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
        payload.destinationConnectionId,
        'OfferManager'
      );
    } catch (error) {
      if (!(error instanceof CapabilityNotSupportedException)) {
        throw error;
      }
    }

    if (marketplaceAdapter) {
      await this.publishToMarketplace(marketplaceAdapter, payload);
      return;
    }

    const shopAdapter = await this.integrationsService.getCapabilityAdapter<ShopProductManagerPort>(
      payload.destinationConnectionId,
      'ProductPublisher'
    );
    await this.publishToShop(shopAdapter, payload);
  }

  private async publishToMarketplace(
    adapter: OfferManagerPort,
    payload: PriceChangeApplyPayload
  ): Promise<void> {
    if (!isOfferFieldUpdater(adapter)) {
      throw new Error(
        `Adapter for connection ${payload.destinationConnectionId} does not support updateOfferFields`
      );
    }

    const page = await this.offerMappings.findForVariant(
      payload.destinationConnectionId,
      payload.productVariantId
    );
    if (page.items.length === 0) {
      throw new Error(
        `No offer mapping found for variant=${payload.productVariantId} on connection=${payload.destinationConnectionId}`
      );
    }

    const publishedAtIso = new Date().toISOString();
    const externalOfferIds = new Set(page.items.map((item) => item.externalId));
    for (const externalOfferId of externalOfferIds) {
      await adapter.updateOfferFields({
        externalOfferId,
        fields: { price: { amount: payload.amount.toFixed(2), currency: payload.currency } },
        idempotencyKey: `pricing:${payload.productVariantId}:${payload.destinationConnectionId}:${externalOfferId}:${publishedAtIso}`,
      });
    }
  }

  private async publishToShop(
    adapter: ShopProductManagerPort,
    payload: PriceChangeApplyPayload
  ): Promise<void> {
    // Master is authoritative including 0 (#824) — the zero-filled read is
    // the right one here, since this call is about to PUBLISH a quantity.
    const [availability] = await this.inventoryQuery.getAvailabilityByVariantIds([
      payload.productVariantId,
    ]);
    const stock = availability?.totalAvailable ?? 0;

    // A price-change episode/automatic-apply only ever exists for an
    // ALREADY-mapped, already-live listing (the detection service walks
    // existing ShopProduct mappings) — so `status: 'published'` is the
    // correct re-publish target, not a guess.
    const command = await this.productPublishBuilder.buildPublishProductCommand({
      internalVariantId: payload.productVariantId,
      connectionId: payload.destinationConnectionId,
      stock,
      status: 'published',
      price: { amount: payload.amount, currency: payload.currency },
    });

    await adapter.publishProduct(command);
  }

  private async advanceBulkProgress(
    payload: PriceChangeApplyPayload,
    outcome: 'succeeded' | 'failed'
  ): Promise<void> {
    if (!payload.batchId) {
      return;
    }
    // The advancement gate keys on `(bulkBatchId, childId)` and enforces no
    // FK — reusing it for a price-change child (rather than a real
    // `OfferCreationRecord`) is exactly the "SAME mechanism" #3144 asks for.
    const childId = payload.episodeId ?? `automatic:${payload.productVariantId}:${payload.destinationConnectionId}`;
    await this.bulkProgress.advanceBatchStatus(payload.batchId, childId, outcome);
  }

  private getPayload(job: SyncJob): PriceChangeApplyPayload {
    const payload = job.payload as unknown as Partial<PriceChangeApplyPayload>;

    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(`Missing payload for job: ${job.id}`, job.id, job.jobType, job.connectionId);
    }
    if (!payload.productVariantId || typeof payload.productVariantId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid productVariantId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (!payload.destinationConnectionId || typeof payload.destinationConnectionId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid destinationConnectionId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (!payload.sourceConnectionId || typeof payload.sourceConnectionId !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid sourceConnectionId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (typeof payload.amount !== 'number' || !Number.isFinite(payload.amount)) {
      throw new SyncJobExecutionError(
        `Missing or invalid amount in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    if (!payload.currency || typeof payload.currency !== 'string') {
      throw new SyncJobExecutionError(
        `Missing or invalid currency in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    return {
      productVariantId: payload.productVariantId,
      destinationConnectionId: payload.destinationConnectionId,
      sourceConnectionId: payload.sourceConnectionId,
      amount: payload.amount,
      currency: payload.currency,
      automatic: payload.automatic === true,
      episodeId: payload.episodeId,
      manualPriceOverride: payload.manualPriceOverride,
      resolvedByUserId: payload.resolvedByUserId,
      batchId: payload.batchId,
    };
  }
}
