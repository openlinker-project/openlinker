/**
 * Price Change Apply Handler (#3144, ADR-072)
 *
 * Handles `pricing.propagateToMarketplaces` — the terminal write for a single
 * price change, whether it arrived via an accepted/edited review-queue
 * episode or directly from an `automatic`-mode detection (#3143).
 *
 * A thin shell (#3161 review, BLOCKING — "sync orchestration policies live in
 * core application services … not in worker handlers",
 * architecture-overview.md § 7 Sync Manager): payload parsing only. All
 * orchestration (capability selection, mapping lookup, availability read,
 * command building, adapter dispatch, episode resolution, auto-applied-log
 * write, bulk-progress advancement) lives in
 * `IPriceChangeApplyService.applyPriceChange`
 * (`libs/core/src/listings/application/services/price-change-apply.service.ts`),
 * which is also what let two `*RepositoryPort` cross-context imports move
 * out of this file (`check-cross-context-imports.mjs` denies a
 * `*RepositoryPort` import from any consumer outside `libs/core`).
 *
 * Follows ADR-007's status/outcome split: the service resolves normally with
 * `outcome: 'business_failure'` for a deterministic condition (a currency
 * mismatch, a missing episode, a destination with neither capability
 * enabled, a seller-frozen price, a rejected shop publish) — never a throw,
 * since retrying an identical call cannot change any of those. A transient
 * error (network failure, an unclassified marketplace/shop rejection)
 * propagates and is wrapped here into `SyncJobExecutionError` with `cause`
 * preserved, so `SyncJobRunner`'s per-plugin `RetryClassifierPort` machinery
 * can still recognise a deterministic adapter-native rejection.
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
import {
  type IPriceChangeApplyService,
  PRICE_CHANGE_APPLY_SERVICE_TOKEN,
  type PriceChangeApplyInput,
} from '@openlinker/core/listings';

type SyncJob = SyncJobEntity;

@Injectable()
export class PriceChangeApplyHandler implements SyncJobHandler {
  private readonly logger = new Logger(PriceChangeApplyHandler.name);

  constructor(
    @Inject(PRICE_CHANGE_APPLY_SERVICE_TOKEN)
    private readonly priceChangeApply: IPriceChangeApplyService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing pricing.propagateToMarketplaces job ${job.id} for connection ${job.connectionId} ` +
        `(variant=${payload.productVariantId}, amount=${payload.amount} ${payload.currency}, automatic=${payload.automatic})`
    );

    try {
      const result = await this.priceChangeApply.applyPriceChange(payload);
      return { outcome: result.outcome };
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
  }

  private getPayload(job: SyncJob): PriceChangeApplyInput {
    const payload = job.payload as unknown as Partial<PriceChangeApplyInput>;

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
