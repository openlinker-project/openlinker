/**
 * Marketplace Offer Poll Creation Status Handler
 *
 * Handles `marketplace.offer.pollCreationStatus` sync jobs (#447). Thin shell
 * around the core `OfferStatusPollService` — parses the payload, delegates
 * the polling-cadence policy + state-machine to core, and returns the outcome
 * the runner records on the row.
 *
 * Each iteration is a fresh `sync_jobs` row written by the core service with
 * a future `nextRunAt`. Transient HTTP/network errors propagate so the
 * runner's per-iteration `maxAttempts=3` budget kicks in. Domain failures
 * (`OfferPollNotSupportedException`, `OfferNotFoundOnMarketplaceException`,
 * timeout) are caught inside core and surface here as a clean
 * `outcome: 'business_failure'` — never thrown.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  IOfferStatusPollService,
  OFFER_STATUS_POLL_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import type {
  MarketplaceOfferPollCreationStatusPayloadV1,
  SyncJob as SyncJobEntity,
  SyncJobHandler,
  SyncJobHandlerResult,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

@Injectable()
export class MarketplaceOfferPollCreationStatusHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOfferPollCreationStatusHandler.name);

  constructor(
    @Inject(OFFER_STATUS_POLL_SERVICE_TOKEN)
    private readonly offerStatusPoll: IOfferStatusPollService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);

    this.logger.log(
      `Executing marketplace.offer.pollCreationStatus job ${job.id} record=${payload.offerCreationRecordId} attempt=${payload.pollAttempt}`
    );

    try {
      const result = await this.offerStatusPoll.pollOnce({
        offerCreationRecordId: payload.offerCreationRecordId,
        externalOfferId: payload.externalOfferId,
        connectionId: job.connectionId,
        pollAttempt: payload.pollAttempt,
      });

      this.logger.log(
        `Poll iteration finished: job=${job.id} record=${payload.offerCreationRecordId} attempt=${payload.pollAttempt} outcome=${result.outcome}`
      );

      return result;
    } catch (error) {
      // Transient HTTP / network errors land here; rethrow as a runner
      // retry signal. The runner's `maxAttempts=3` per iteration absorbs
      // 1-2 transient blips before this iteration is marked dead.
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `marketplace.offer.pollCreationStatus job failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOfferPollCreationStatusPayloadV1 {
    const payload = job.payload as unknown as Partial<MarketplaceOfferPollCreationStatusPayloadV1>;

    if (!payload || typeof payload !== 'object') {
      throw new SyncJobExecutionError(
        `Missing payload for job: ${job.id}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    if (payload.schemaVersion !== 1) {
      throw new SyncJobExecutionError(
        `Unsupported schemaVersion (${String(payload.schemaVersion)}) in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    if (
      typeof payload.offerCreationRecordId !== 'string' ||
      payload.offerCreationRecordId.length === 0
    ) {
      throw new SyncJobExecutionError(
        `Missing or invalid offerCreationRecordId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    if (typeof payload.externalOfferId !== 'string' || payload.externalOfferId.length === 0) {
      throw new SyncJobExecutionError(
        `Missing or invalid externalOfferId in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    if (
      typeof payload.pollAttempt !== 'number' ||
      !Number.isInteger(payload.pollAttempt) ||
      payload.pollAttempt < 1
    ) {
      throw new SyncJobExecutionError(
        `Missing or invalid pollAttempt in payload: ${JSON.stringify(job.payload)}`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    return {
      schemaVersion: 1,
      offerCreationRecordId: payload.offerCreationRecordId,
      externalOfferId: payload.externalOfferId,
      pollAttempt: payload.pollAttempt,
    };
  }
}
