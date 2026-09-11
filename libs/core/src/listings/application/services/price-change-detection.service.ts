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
 * - `readPriceSyncModeForSource` decides whether an ALREADY-opened episode
 *   (see below) is also, additionally, enqueued for automatic apply
 *   (ADR-072 decision 3).
 *
 * The episode is opened or refreshed via `upsertOpen` in EVERY mode,
 * including automatic (#3159 review) — an automatic-mode pair is never a
 * silent bypass with no persisted trace; the apply job's idempotency key is
 * keyed on the resulting episode's own id (`pricing:episode:{id}:auto`),
 * which is what lets a price that reverts to an earlier value re-enqueue
 * instead of colliding with a stale key from an earlier promotion.
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

    let computedOldAmount: number | null;
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

    // The episode is opened/refreshed FIRST, in every mode — including
    // automatic (#3159 review, BLOCKING). Keying the automatic-apply job's
    // idempotency on the raw `sourceNewAmount` alone let a price that
    // REVERTED to an earlier value collide with a stale key forever
    // (`sync_jobs.idempotencyKey` is UNIQUE, with no TTL and no retention
    // sweep in the tree): 350 -> 327 -> 350 -> 327 mints an identical key on
    // the third step and is silently dropped. The episode's own id is what
    // the key names below, and a genuinely new detection always mints a
    // fresh (or freshly-refreshed) episode. This also gives the automatic
    // path the audit row it never had.
    const { episode } = await this.episodes.upsertOpen({
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

    // Automatic mode bypasses the review queue entirely (ADR-072 decision 3)
    // — but only for a FRESH detection; an episode already open (e.g. a rare
    // mode-flip mid-review) is left for the operator rather than silently
    // discarded.
    if (!openEpisode && !blockReason) {
      const mode = readPriceSyncModeForSource(connection.config, observation.sourceConnectionId);
      if (mode === 'automatic') {
        await this.enqueueAutomaticApply(destinationConnectionId, observation, computedNewAmount, episode.id);
      }
    }
  }

  /**
   * The "last applied price" baseline (#3143's stated assumption): the most
   * recently RESOLVED episode's effective (pinned-or-computed) amount, or —
   * when no episode has ever existed for this key — the rule applied to the
   * source's OLD amount. When there is no old amount either (a brand-new
   * mapping), there is no baseline at all: `null` (#3159 review) — never
   * `0` overloaded as that sentinel, which made a first-ever detection
   * indistinguishable from a real zero baseline and had `deltaPct()`
   * misreport its direction as "down" (`0 -> N` reads as a positive delta,
   * but `computedOldAmount === 0` short-circuited to `0`). `null` compares
   * unequal to any real `computedNewAmount`, so the caller's "unchanged"
   * guard still cannot short-circuit on it — the change is unconditionally
   * treated as "changed" on first sight, exactly like a newly-mapped
   * listing, and the direction is reported as unknown rather than guessed.
   */
  private async resolveBaselineAmount(
    destinationConnectionId: string,
    observation: MasterPriceChangeObservation,
    rule: Parameters<typeof applyPricingRule>[1]
  ): Promise<number | null> {
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
    // No baseline at all (a brand-new mapping with no recorded prior price).
    return null;
  }

  /**
   * Enqueues the automatic-apply job for an episode that already exists
   * (opened or refreshed by the caller's `upsertOpen` call, #3159 review).
   * Keying on the episode's own id — rather than the raw `sourceNewAmount`
   * — is what makes a reverted price re-enqueue instead of silently
   * colliding with a stale idempotency key from an earlier promotion.
   */
  private async enqueueAutomaticApply(
    destinationConnectionId: string,
    observation: MasterPriceChangeObservation,
    computedAmount: number,
    episodeId: string
  ): Promise<void> {
    const idempotencyKey = `pricing:episode:${episodeId}:auto`;
    const result = await this.jobEnqueue.enqueueJob({
      jobType: 'pricing.propagateToMarketplaces',
      connectionId: destinationConnectionId,
      payload: {
        episodeId,
        productVariantId: observation.productVariantId,
        destinationConnectionId,
        sourceConnectionId: observation.sourceConnectionId,
        amount: computedAmount,
        currency: observation.sourceCurrency,
        automatic: true,
      },
      idempotencyKey,
    });
    if (result.isExisting) {
      // Not the reversion case above (that mints a fresh episode id, hence a
      // fresh key) — this means the SAME episode was re-detected before its
      // automatic-apply job ran. Logged rather than silently discarded
      // (#3159 review: `EnqueueJobResult` was previously dropped entirely).
      this.logger.warn(
        `[price-change-detection] automatic-apply job already enqueued for episode=${episodeId} ` +
          `destination=${destinationConnectionId} — skipping duplicate (idempotencyKey=${idempotencyKey})`
      );
    }
  }
}
