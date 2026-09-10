/**
 * Price Changes Service (#3145, ADR-072)
 *
 * The single application-layer owner of the review-queue read + the
 * accept/ignore/edit/bulk-accept/unresolve write paths. Enriches
 * `PriceChangeEpisode` rows with product/connection identity so the API
 * controller stays a thin pass-through, and enqueues
 * `pricing.propagateToMarketplaces` for every accepted/edited episode
 * (#3144 owns the actual publish).
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
  type ConnectionConfig,
  readPricingRuleForSource,
  readPriceSyncModeConfig,
} from '@openlinker/core/identifier-mapping';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import { JOB_ENQUEUE_TOKEN, type JobEnqueuePort } from '@openlinker/core/sync';
import type { ProductVariant } from '@openlinker/core/products';
import type { PriceChangeEpisode } from '../../domain/entities/price-change-episode.entity';
import { PriceChangeEpisodeRepositoryPort } from '../../domain/ports/price-change-episode-repository.port';
import { PriceChangeAutoAppliedLogRepositoryPort } from '../../domain/ports/price-change-auto-applied-log-repository.port';
import { BulkListingBatchRepositoryPort } from '../../domain/ports/bulk-listing-batch-repository.port';
import type { PriceChangeAutoAppliedLogEntry } from '../../domain/entities/price-change-auto-applied-log-entry.entity';
import type { PriceChangeEpisodeFilters } from '../../domain/types/price-change-episode.types';
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
} from './price-changes.service.interface';
import type {
  PriceChangeQueueItem,
  PriceChangeQueuePage,
} from '../types/price-change-queue-item.types';

const JOB_TYPE = 'pricing.propagateToMarketplaces';

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
    const episodes = filters.destinationConnectionId
      ? await this.episodes.findOpenForConnection(filters.destinationConnectionId, filters)
      : await this.episodes.findOpenAll(filters);

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

    return { items, hiddenStaleCount };
  }

  async countOpen(filters: PriceChangeEpisodeFilters): Promise<number> {
    return this.episodes.countOpen(filters);
  }

  async accept(episodeId: string, input: AcceptPriceChangeInput): Promise<void> {
    const episode = await this.loadActionable(episodeId, input.expectedVersion);
    await this.enqueuePublish(episode, {
      amount: episode.computedNewAmount,
      manualPriceOverride: false,
      resolvedByUserId: input.resolvedByUserId,
    });
    if (input.optInAutomatic) {
      await this.setSourceOverrideAutomatic(episode.destinationConnectionId, episode.sourceConnectionId);
    }
  }

  async edit(episodeId: string, input: EditPriceChangeInput): Promise<void> {
    const episode = await this.loadActionable(episodeId, input.expectedVersion);
    await this.enqueuePublish(episode, {
      amount: input.manualPriceOverride,
      manualPriceOverride: true,
      resolvedByUserId: input.resolvedByUserId,
    });
    if (input.optInAutomatic) {
      await this.setSourceOverrideAutomatic(episode.destinationConnectionId, episode.sourceConnectionId);
    }
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
    const reopened = await this.episodes.reopenIgnored(episodeId);
    if (!reopened) {
      const episode = await this.episodes.findById(episodeId);
      if (!episode) {
        throw new PriceChangeEpisodeNotFoundException(episodeId);
      }
      throw new PriceChangeEpisodeAlreadyResolvedException(episodeId);
    }
  }

  async bulkAccept(
    items: BulkAcceptItemInput[],
    resolvedByUserId: string | null
  ): Promise<BulkAcceptResult> {
    const episodesToApply: { episode: PriceChangeEpisode; optInAutomatic: boolean }[] = [];
    for (const item of items) {
      const episode = await this.loadActionable(item.id);
      episodesToApply.push({ episode, optInAutomatic: item.optInAutomatic === true });
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

    for (const { episode, optInAutomatic } of episodesToApply) {
      await this.enqueuePublish(episode, {
        amount: episode.computedNewAmount,
        manualPriceOverride: false,
        resolvedByUserId,
        batchId: batch.id,
      });
      if (optInAutomatic) {
        await this.setSourceOverrideAutomatic(episode.destinationConnectionId, episode.sourceConnectionId);
      }
    }

    return { batchId: batch.id, totalCount: episodesToApply.length };
  }

  async listAutoApplied(limit: number): Promise<readonly PriceChangeAutoAppliedLogEntry[]> {
    return this.autoAppliedLog.findRecent(limit);
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
    if (!episode.isOpen()) {
      throw new PriceChangeEpisodeAlreadyResolvedException(episodeId);
    }
    if (episode.blockReason) {
      throw new PriceChangeEpisodeBlockedException(episodeId, episode.blockReason);
    }
    if (expectedVersion !== undefined) {
      const currentVersion = this.versionOf(episode);
      if (currentVersion !== expectedVersion) {
        throw new PriceChangeEpisodeStaleException(episodeId, expectedVersion, currentVersion);
      }
    }
    return episode;
  }

  private versionOf(episode: PriceChangeEpisode): string {
    return (episode.refreshedAt ?? episode.detectedAt).toISOString();
  }

  private async enqueuePublish(
    episode: PriceChangeEpisode,
    options: {
      amount: number;
      manualPriceOverride: boolean;
      resolvedByUserId: string | null;
      batchId?: string;
    }
  ): Promise<void> {
    await this.jobEnqueue.enqueueJob({
      jobType: JOB_TYPE,
      connectionId: episode.destinationConnectionId,
      idempotencyKey: `pricing:episode:${episode.id}:${options.batchId ?? 'single'}:${options.amount}`,
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
  }

  private async setSourceOverrideAutomatic(
    destinationConnectionId: string,
    sourceConnectionId: string
  ): Promise<void> {
    try {
      const connection = await this.connections.get(destinationConnectionId);
      const existing = readPriceSyncModeConfig(connection.config);
      const updatedConfig: ConnectionConfig = {
        ...connection.config,
        priceSyncMode: {
          default: existing.default,
          sourceOverrides: { ...existing.sourceOverrides, [sourceConnectionId]: 'automatic' },
        },
      };
      await this.connections.update(destinationConnectionId, { config: updatedConfig });
    } catch (error) {
      // Best-effort: the price publish already succeeded/enqueued, and a
      // failure to flip the mode must not be reported as a failed accept.
      this.logger.warn(
        `[price-changes] failed to opt (${sourceConnectionId} -> ${destinationConnectionId}) into automatic mode: ${(error as Error).message}`
      );
    }
  }

  private async fetchConnections(ids: string[]): Promise<Map<string, Connection>> {
    const map = new Map<string, Connection>();
    for (const id of ids) {
      try {
        map.set(id, await this.connections.get(id));
      } catch {
        // A deleted connection: the episode still renders with a fallback label.
      }
    }
    return map;
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
      destinationCurrency: episode.sourceCurrency,
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
