/**
 * Price Change Detection Service (#3143, ADR-072)
 *
 * The single implementation of `PriceChangeObserverPort` (`@openlinker/core/products`)
 * — bound host-side to this class via a `@Global()` composition module (see
 * that port's docblock for why). Every master price change lands here, for
 * every DESTINATION connection the changed variant is currently mapped to
 * (via an `Offer` or `ShopProduct` identifier mapping — both keyed by variant
 * id, so `IIdentifierMappingService.getExternalIds` returns exactly the
 * destination connection ids to fan out over).
 *
 * Per destination, per (destination, source) pair:
 * - `resolvePriceChangeBlockReason` decides the currency-mismatch block
 *   (ADR-072 decision 4) — a pure function, re-decided on every pass.
 * - `readPricingRuleForSource` / `applyPricingRule` compute the destination
 *   price.
 * - `readPriceSyncModeForSource` decides `manual` (open/refresh a reviewable
 *   episode) vs `automatic` (bypass the review queue and enqueue the apply
 *   job directly, ADR-072 decision 3).
 *
 * @module libs/core/src/listings/application/services
 * @implements {IPriceChangeDetectionService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { MasterPriceChangeObservation } from '@openlinker/core/products';
import {
  CONNECTION_PORT_TOKEN,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type ConnectionPort,
  type IIdentifierMappingService,
  applyPricingRule,
  readPricingRuleForSource,
  readPriceSyncModeForSource,
} from '@openlinker/core/identifier-mapping';
import { JOB_ENQUEUE_TOKEN, type JobEnqueuePort } from '@openlinker/core/sync';
import { PriceChangeEpisodeRepositoryPort } from '../../domain/ports/price-change-episode-repository.port';
import { PRICE_CHANGE_EPISODE_REPOSITORY_TOKEN } from '../../listings.tokens';
import {
  resolvePriceChangeBlockReason,
  readConnectionCurrency,
} from '../../domain/types/price-change-block.types';
import type { IPriceChangeDetectionService } from './price-change-detection.service.interface';

@Injectable()
export class PriceChangeDetectionService implements IPriceChangeDetectionService {
  private readonly logger = new Logger(PriceChangeDetectionService.name);

  constructor(
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(PRICE_CHANGE_EPISODE_REPOSITORY_TOKEN)
    private readonly episodes: PriceChangeEpisodeRepositoryPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  async onMasterPriceChanged(observation: MasterPriceChangeObservation): Promise<void> {
    if (
      observation.sourceOldAmount !== null &&
      observation.sourceOldAmount === observation.sourceNewAmount
    ) {
      return; // nothing changed at the source — nothing to detect
    }

    const [offerMappings, shopMappings] = await Promise.all([
      this.identifierMapping.getExternalIds('Offer', observation.productVariantId),
      this.identifierMapping.getExternalIds('ShopProduct', observation.productVariantId),
    ]);
    const destinationConnectionIds = Array.from(
      new Set([...offerMappings, ...shopMappings].map((m) => m.connectionId))
    );

    for (const destinationConnectionId of destinationConnectionIds) {
      try {
        await this.detectForDestination(destinationConnectionId, observation);
      } catch (error) {
        this.logger.warn(
          `[price-change-detection] failed for variant=${observation.productVariantId} destination=${destinationConnectionId}: ${(error as Error).message}`
        );
      }
    }
  }

  private async detectForDestination(
    destinationConnectionId: string,
    observation: MasterPriceChangeObservation
  ): Promise<void> {
    const connection = await this.connections.get(destinationConnectionId).catch(() => null);
    if (!connection || connection.status !== 'active') {
      return;
    }

    const blockReason = resolvePriceChangeBlockReason(
      observation.sourceCurrency,
      readConnectionCurrency(connection.config)
    );
    const rule = readPricingRuleForSource(connection.config, observation.sourceConnectionId);
    const computedNewAmount = applyPricingRule(observation.sourceNewAmount, rule);

    const openEpisode = await this.episodes.findOpenByKey(
      observation.productVariantId,
      destinationConnectionId,
      observation.sourceConnectionId
    );

    let computedOldAmount: number;
    if (openEpisode) {
      // The conflict-arm write never touches the "old" amounts (see
      // `PriceChangeEpisodeRepository.upsertOpen`) — the operator should still
      // see what the price was BEFORE any of this started, not the value from
      // the last refresh.
      computedOldAmount = openEpisode.computedOldAmount;
    } else {
      computedOldAmount = await this.resolveBaselineAmount(
        destinationConnectionId,
        observation,
        rule
      );
      if (computedOldAmount === computedNewAmount && !blockReason) {
        return; // nothing to review, and no episode already exists to refresh
      }
    }

    // Automatic mode bypasses the review queue entirely (ADR-072 decision 3)
    // — but only for a FRESH detection; an episode already open (e.g. a rare
    // mode-flip mid-review) is left for the operator rather than silently
    // discarded.
    if (!openEpisode && !blockReason) {
      const mode = readPriceSyncModeForSource(connection.config, observation.sourceConnectionId);
      if (mode === 'automatic') {
        await this.enqueueAutomaticApply(destinationConnectionId, observation, computedNewAmount);
        return;
      }
    }

    await this.episodes.upsertOpen({
      productVariantId: observation.productVariantId,
      destinationConnectionId,
      sourceConnectionId: observation.sourceConnectionId,
      sourceCurrency: observation.sourceCurrency,
      sourceOldAmount: observation.sourceOldAmount ?? observation.sourceNewAmount,
      sourceNewAmount: observation.sourceNewAmount,
      computedOldAmount,
      computedNewAmount,
      blockReason,
      detectedAt: new Date(),
    });
  }

  /**
   * The "last applied price" baseline (#3143's stated assumption): the most
   * recently RESOLVED episode's effective (pinned-or-computed) amount, or —
   * when no episode has ever existed for this key — the rule applied to the
   * source's OLD amount. When there is no old amount either (a brand-new
   * mapping), there is no baseline at all: return a value that can never
   * equal the new computed amount, so the change is unconditionally treated
   * as "changed" on first sight, exactly like a newly-mapped listing.
   */
  private async resolveBaselineAmount(
    destinationConnectionId: string,
    observation: MasterPriceChangeObservation,
    rule: Parameters<typeof applyPricingRule>[1]
  ): Promise<number> {
    const lastResolved = await this.episodes.findLastResolvedByKey(
      observation.productVariantId,
      destinationConnectionId,
      observation.sourceConnectionId
    );
    if (lastResolved) {
      return lastResolved.effectiveAmount();
    }
    if (observation.sourceOldAmount !== null) {
      return applyPricingRule(observation.sourceOldAmount, rule);
    }
    // No baseline at all (a brand-new mapping with no recorded prior price):
    // `0` is never a real resolved price, so this unconditionally reads as
    // "changed" — matching how a newly-mapped listing would naturally
    // surface. Using `0` rather than `NaN` also keeps the value persistable
    // (the episode's non-negative amounts CHECK constraint).
    return 0;
  }

  private async enqueueAutomaticApply(
    destinationConnectionId: string,
    observation: MasterPriceChangeObservation,
    computedAmount: number
  ): Promise<void> {
    const idempotencyKey = `pricing:${destinationConnectionId}:${observation.sourceConnectionId}:${observation.productVariantId}:${observation.sourceNewAmount}`;
    await this.jobEnqueue.enqueueJob({
      jobType: 'pricing.propagateToMarketplaces',
      connectionId: destinationConnectionId,
      payload: {
        productVariantId: observation.productVariantId,
        destinationConnectionId,
        sourceConnectionId: observation.sourceConnectionId,
        amount: computedAmount,
        currency: observation.sourceCurrency,
        automatic: true,
      },
      idempotencyKey,
    });
  }
}
