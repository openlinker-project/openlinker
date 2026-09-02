/**
 * Stale Offer Pause Service
 *
 * Orchestrates the stale-variant offer pause (#1689) — the buyer-protection
 * close of the fail-open gap left by #1599: from a master-side deletion until
 * an operator notices, a mapped marketplace offer stayed live at its
 * last-known quantity, letting buyers purchase a product that no longer
 * exists. This service has two entry points that share the same
 * enqueue-and-count core:
 *
 *   - `pauseOffersForVariants` — the event-driven trigger. Re-reads each
 *     variant's `isStale` flag immediately before enqueuing (never trust the
 *     event's variant list as authority — a reappearance racing the event
 *     must never zero a live offer), then resolves the still-stale variants'
 *     mapped offers via `IIdentifierMappingService.getExternalIds` and
 *     enqueues one `marketplace.offerQuantity.update` job per mapping.
 *   - `sweepConnection` — the reconcile guarantee. Because the deletion event
 *     (`events.master.deletion`) is published at-most-once (fire-after-commit,
 *     never re-emitted), a lost message would otherwise leave the offer live
 *     forever. The sweep pages a connection's currently stale-mapped variants
 *     straight from the persisted `isStale` flag
 *     (`OfferMappingRepositoryPort.findStaleMappedVariants`) and re-asserts
 *     the same pause.
 *
 * Every enqueue is an ABSOLUTE quantity-0 set, deduped by
 * `stale-pause:{connectionId}:{externalOfferId}:{staleAt}` — re-running the
 * sweep against an unchanged stale set enqueues no duplicate work, while a
 * variant that un-stales and re-stales gets a fresh `staleAt` and pauses
 * again. The adapter-level `idempotencyKey` is deliberately left unset so
 * `InventorySyncService` derives its usual quantity-based key — a
 * deletion-driven 0 and an inventory-driven 0 collapse to the same
 * marketplace command.
 *
 * A single mapping's enqueue failure never aborts the run: failures are
 * logged and counted, not thrown, since the reconcile sweep is the backstop.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IStaleOfferPauseService}
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import { SyncJobQueuePort, SYNC_JOB_QUEUE_TOKEN } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';
import { OFFER_MAPPING_REPOSITORY_TOKEN } from '../../listings.tokens';
import { OfferMappingRepositoryPort } from '../../domain/ports/offer-mapping-repository.port';
import type { StaleOfferPauseResult } from '../../domain/types/stale-offer-pause.types';
import type { IStaleOfferPauseService } from '../interfaces/stale-offer-pause.service.interface';

/** Recency window for the reconcile sweep — see this file's header. */
const DEFAULT_STALE_WINDOW_DAYS = 30;

interface PauseTarget {
  connectionId: string;
  externalOfferId: string;
  staleAt: Date;
}

@Injectable()
export class StaleOfferPauseService implements IStaleOfferPauseService {
  private readonly logger = new Logger(StaleOfferPauseService.name);

  constructor(
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappings: OfferMappingRepositoryPort,
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort
  ) {}

  async pauseOffersForVariants(input: {
    variantIds: readonly string[];
    correlationId: string;
  }): Promise<StaleOfferPauseResult> {
    const { variantIds, correlationId } = input;
    const result: StaleOfferPauseResult = {
      variantsConsidered: variantIds.length,
      variantsStillStale: 0,
      offersPaused: 0,
      offersSkipped: 0,
    };

    for (const variantId of variantIds) {
      const variant = await this.productsService.getVariant(variantId);
      if (!variant || variant.isStale !== true || !variant.staleAt) {
        this.logger.debug(
          `Skipping stale-offer pause for ${variantId} — no longer stale (correlationId: ${correlationId})`
        );
        continue;
      }
      result.variantsStillStale += 1;

      const offerMappings = await this.identifierMapping.getExternalIds(
        CORE_ENTITY_TYPE.Offer,
        variantId
      );
      const staleAt = variant.staleAt;
      for (const mapping of offerMappings) {
        const paused = await this.enqueuePause({
          connectionId: mapping.connectionId,
          externalOfferId: mapping.externalId,
          staleAt,
        });
        if (paused) {
          result.offersPaused += 1;
        } else {
          result.offersSkipped += 1;
        }
      }
    }

    this.logger.warn(
      `Stale-offer pause (trigger) complete: considered=${result.variantsConsidered}, stillStale=${result.variantsStillStale}, paused=${result.offersPaused}, skipped=${result.offersSkipped} (correlationId: ${correlationId})`
    );
    return result;
  }

  async sweepConnection(
    connectionId: string,
    options: { limit: number }
  ): Promise<StaleOfferPauseResult> {
    const staleSince = new Date(Date.now() - DEFAULT_STALE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const staleMappedVariants = await this.offerMappings.findStaleMappedVariants(connectionId, {
      limit: options.limit,
      staleSince,
    });

    const result: StaleOfferPauseResult = {
      variantsConsidered: staleMappedVariants.length,
      variantsStillStale: staleMappedVariants.length,
      offersPaused: 0,
      offersSkipped: 0,
    };

    for (const row of staleMappedVariants) {
      const paused = await this.enqueuePause({
        connectionId,
        externalOfferId: row.externalOfferId,
        staleAt: row.staleAt,
      });
      if (paused) {
        result.offersPaused += 1;
      } else {
        result.offersSkipped += 1;
      }
    }

    this.logger.debug(
      `Stale-offer pause (sweep) complete for connection ${connectionId}: found=${result.variantsConsidered}, paused=${result.offersPaused}, skipped=${result.offersSkipped}`
    );
    return result;
  }

  /**
   * Enqueue one absolute quantity-0 update for a stale-mapped offer. Never
   * throws — an enqueue failure is logged and reported to the caller as a
   * skip, since the reconcile sweep re-asserts on the next tick.
   */
  private async enqueuePause(target: PauseTarget): Promise<boolean> {
    const dedupeKey = `stale-pause:${target.connectionId}:${target.externalOfferId}:${target.staleAt.toISOString()}`;
    try {
      await this.jobQueue.enqueue({
        type: 'marketplace.offerQuantity.update',
        connectionId: target.connectionId,
        payload: {
          schemaVersion: 1,
          offerId: target.externalOfferId,
          quantity: 0,
          // #2285 — the stale transition IS the observation this write expresses, so
          // a re-pause after a restock derives a fresh key instead of reusing a dead
          // command id and leaving the offer selling.
          observedAt: target.staleAt.toISOString(),
        },
        options: { dedupeKey },
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to enqueue stale-offer pause for offer ${target.externalOfferId} (connection: ${target.connectionId})`,
        (error as Error).stack
      );
      return false;
    }
  }
}
