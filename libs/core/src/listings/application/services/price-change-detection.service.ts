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
 * instead of colliding with a stale key from an earlier promotion. And a
 * STILL-OPEN episode that genuinely refreshes again (the price moved before
 * the first apply job ran) also re-enqueues, under a further-suffixed key
 * derived from `refreshedAt` — see `enqueueAutomaticApply`'s docblock —
 * since automatic mode has no operator watching the review queue to catch a
 * silently-dropped second change.
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
  type Connection,
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

  /**
   * A short-lived, per-instance cache for `connections.get` (#3159 review,
   * IMPORTANT — the catalogue-sweep cost finding).
   *
   * `onMasterPriceChanged` is invoked once PER CHANGED VARIANT from
   * `MasterProductSyncService.notifyPriceChanges`, sequentially, inside
   * `master.product.syncBatch` (#2593/#2594/ADR-066's tuned `bulk`-lane
   * path) — a 100-product page with 3 variants and 2 destination
   * connections each would otherwise call `this.connections.get` up to 600
   * times for only 2 DISTINCT connections. A per-call cache cannot live on
   * the `PriceChangeObserverPort` contract (it crosses the `products ->
   * listings` boundary with no shared-state parameter, and widening it would
   * leak a `listings`-internal concern onto a port `products` also owns), so
   * this lives here instead, bounded by a short TTL rather than the whole
   * batch's lifetime — a genuinely UPDATED connection (credentials rotated,
   * disabled mid-sweep) is visible again within `CONNECTION_CACHE_TTL_MS`,
   * trading a small staleness window for cutting the dominant per-variant
   * cost on the hot catalogue-sweep path.
   */
  private readonly connectionCache = new Map<
    string,
    { connection: Connection | null; expiresAt: number }
  >();
  private static readonly CONNECTION_CACHE_TTL_MS = 5_000;

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
    const connection = await this.getConnectionCached(destinationConnectionId);
    if (!connection || connection.status !== 'active') {
      // Logged rather than silent (#3159 review, SUGGESTION — the
      // `analytics-trust` #1982 lesson): a destination that flipped to
      // `needs_reauth`/`disabled`/`error` mid-sweep otherwise stops accruing
      // episodes with no trace anywhere. Best-effort visibility only — this
      // is not a retryable condition, and the next detection pass re-checks
      // the connection from scratch.
      this.logger.warn(
        `[price-change-detection] skipping destination=${destinationConnectionId} for variant=${observation.productVariantId}: ` +
          (connection ? `connection status is '${connection.status}', not 'active'` : 'connection not found')
      );
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
      // NEVER `?? observation.sourceNewAmount` (#3159 review, BLOCKING): a
      // variant that previously had no recorded source price reports
      // `sourceOldAmount: null` from the observer, and fabricating "old = new"
      // here would persist a real-looking "changed from 430.50 to 430.50"
      // fact the source never asserted — the identical defect the
      // `computedOldAmount` nullability fix above closed, left standing on
      // this sibling column.
      sourceOldAmount: observation.sourceOldAmount,
      sourceNewAmount: observation.sourceNewAmount,
      computedOldAmount,
      computedNewAmount,
      blockReason,
      detectedAt: new Date(),
    });

    // Automatic mode bypasses the review queue entirely (ADR-072 decision 3).
    // A FRESH detection always enqueues. A STILL-OPEN episode also
    // re-enqueues, but only when THIS pass genuinely REFRESHED it — the price
    // moved again while the previous detection's apply job hadn't run yet
    // (#3159 review, IMPORTANT). Without this, an automatic-mode pair had no
    // operator watching the queue and a second change arriving before the
    // first apply ran was silently dropped, leaving the destination
    // advertising a stale price permanently. "Genuinely refreshed" is read
    // off `refreshedAt` ADVANCING (compared against `openEpisode`'s value
    // from BEFORE this write), never off `wasRefresh` alone — `wasRefresh` is
    // true for any conflict-arm write, including a no-op repeat of an
    // already-stored, already-enqueued price, which must NOT re-enqueue.
    if (!blockReason) {
      const mode = readPriceSyncModeForSource(connection.config, observation.sourceConnectionId);
      if (mode === 'automatic') {
        const isFreshDetection = !openEpisode;
        const wasJustRefreshed =
          !isFreshDetection &&
          episode.refreshedAt !== null &&
          episode.refreshedAt.getTime() !== (openEpisode?.refreshedAt?.getTime() ?? -1);
        if (isFreshDetection || wasJustRefreshed) {
          await this.enqueueAutomaticApply(
            destinationConnectionId,
            observation,
            computedNewAmount,
            episode.id,
            wasJustRefreshed ? episode.refreshedAt.getTime() : undefined
          );
        }
      }
    }

    // NOTE (#3159 review, unowned by this pass): nothing here ever RESOLVES
    // an automatic-mode episode — that's the downstream apply job's job
    // (#3161/#3162 territory) — so every auto-applied change still leaves an
    // open row inflating the review-queue's `countOpen` badges until it does.
  }

  /** See the `connectionCache` field docblock. */
  private async getConnectionCached(connectionId: string): Promise<Connection | null> {
    const now = Date.now();
    const cached = this.connectionCache.get(connectionId);
    if (cached && cached.expiresAt > now) {
      return cached.connection;
    }
    const connection = await this.connections.get(connectionId).catch(() => null);
    this.connectionCache.set(connectionId, {
      connection,
      expiresAt: now + PriceChangeDetectionService.CONNECTION_CACHE_TTL_MS,
    });
    return connection;
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
   *
   * `refreshMarker` is `undefined` for the episode's FIRST (fresh-detection)
   * enqueue and the still-monotonic `refreshedAt.getTime()` for every
   * subsequent one (#3159 review, IMPORTANT) — an already-open episode's
   * original job may already be queued (or have already run) under the bare
   * `pricing:episode:{id}:auto` key, so a later genuine refresh needs a
   * DISTINCT key to enqueue at all. `refreshedAt` — never the raw amount —
   * is what makes that distinct suffix collision-free: it is a fresh `now()`
   * on every real refresh and therefore never repeats, unlike a price that
   * oscillates back to an earlier value.
   */
  private async enqueueAutomaticApply(
    destinationConnectionId: string,
    observation: MasterPriceChangeObservation,
    computedAmount: number,
    episodeId: string,
    refreshMarker?: number
  ): Promise<void> {
    const idempotencyKey =
      refreshMarker === undefined
        ? `pricing:episode:${episodeId}:auto`
        : `pricing:episode:${episodeId}:auto:${refreshMarker}`;
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
