/**
 * Marketplace Offer Create Handler
 *
 * Handles sync jobs of type `marketplace.offer.create`. Acts as a thin shell
 * around the core `OfferCreationExecutionService` — it validates the payload,
 * delegates the orchestration policy to core, and translates unexpected
 * failures into retryable `SyncJobExecutionError`s.
 *
 * Per `architecture-overview.md` §6, orchestration lives in a core application
 * service rather than the handler so that the future REST endpoint (#259) and
 * this worker path share identical semantics.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  IOfferCreationExecutionService,
  OFFER_CREATION_EXECUTION_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import {
  MarketplaceOfferCreatePayloadV1,
  SyncJob as SyncJobEntity,
  SyncJobExecutionError,
  SyncJobHandler,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceOfferCreateHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOfferCreateHandler.name);

  constructor(
    @Inject(OFFER_CREATION_EXECUTION_SERVICE_TOKEN)
    private readonly offerCreation: IOfferCreationExecutionService,
  ) {}

  async execute(job: SyncJob): Promise<void> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.offer.create job ${job.id} variant=${payload.internalVariantId} connection=${job.connectionId}`,
    );

    try {
      const { offerCreationRecord } = await this.offerCreation.executeCreation({
        internalVariantId: payload.internalVariantId,
        connectionId: job.connectionId,
        stock: payload.stock,
        publishImmediately: payload.publishImmediately,
        price: payload.price,
        overrides: payload.overrides,
        idempotencyKey: payload.idempotencyKey,
        offerCreationRecordId: payload.offerCreationRecordId,
      });

      this.logger.log(
        `Offer creation finished: job=${job.id} recordId=${offerCreationRecord.id} status=${offerCreationRecord.status} externalOfferId=${offerCreationRecord.externalOfferId ?? 'n/a'}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `marketplace.offer.create job failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOfferCreatePayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceOfferCreatePayloadV1>;

    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    if (payload.schemaVersion !== 1) {
      throw new SyncJobExecutionError(
        `Unsupported schemaVersion (${String(payload.schemaVersion)}) in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    if (typeof payload.internalVariantId !== 'string' || payload.internalVariantId.length === 0) {
      throw new SyncJobExecutionError(
        `Missing or invalid internalVariantId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    if (typeof payload.stock !== 'number' || !Number.isInteger(payload.stock) || payload.stock < 0) {
      throw new SyncJobExecutionError(
        `Missing or invalid stock in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    if (typeof payload.publishImmediately !== 'boolean') {
      throw new SyncJobExecutionError(
        `Missing or invalid publishImmediately in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId,
      );
    }

    return {
      schemaVersion: 1,
      internalVariantId: payload.internalVariantId,
      stock: payload.stock,
      publishImmediately: payload.publishImmediately,
      price: payload.price,
      overrides: payload.overrides,
      idempotencyKey: payload.idempotencyKey,
      offerCreationRecordId: payload.offerCreationRecordId,
    };
  }
}
