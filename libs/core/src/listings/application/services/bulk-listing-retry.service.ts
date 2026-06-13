/**
 * Bulk Offer Creation Retry Service (#742)
 *
 * Re-runs the failed children of a `BulkListingBatch`. Owns the
 * counter-reopen policy: deletes per-record `bulk_batch_advancements` rows,
 * decrements `failedCount` per-record (lock-stepped to local writes),
 * transitions terminal-state batches back to `'running'` after the loop,
 * and enqueues fresh `marketplace.offer.create` jobs with a wave-distinct
 * idempotency key.
 *
 * Sibling to:
 *  - `BulkListingSubmitService` (#736) — initial submit.
 *  - `BulkListingProgressService` (#737) — counter advancement.
 *
 * Closes out the bulk-listing backend epic (#726).
 *
 * Direct dependency on `JobEnqueuePort` (not `IOfferCreationEnqueueService`):
 * the enqueue service always creates a NEW `OfferCreationRecord` as its
 * first step; the retry path reuses the existing failed record post-reset.
 * Branching `enqueueCreation` to support both would complicate a
 * hot-path service. The retry service assembles the V2 payload inline.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IBulkListingRetryService}
 * @see {@link IBulkListingRetryService} for the contract
 */
import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  type MarketplaceOfferCreatePayloadV2,
  type OfferDescriptionTone,
  OfferDescriptionToneValues,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import { AdapterCapabilityNotSupportedException } from '../../domain/exceptions/adapter-capability-not-supported.exception';
import { BulkListingBatchNotFoundException } from '../../domain/exceptions/bulk-listing-batch-not-found.exception';
import { BulkRetryMissingSnapshotException } from '../../domain/exceptions/bulk-retry-missing-snapshot.exception';
import { NoFailedChildrenToRetryException } from '../../domain/exceptions/no-failed-children-to-retry.exception';
import { BulkBatchAdvancementRepositoryPort } from '../../domain/ports/bulk-batch-advancement-repository.port';
import { BulkListingBatchRepositoryPort } from '../../domain/ports/bulk-listing-batch-repository.port';
import { isOfferCreator } from '../../domain/ports/capabilities/offer-creator.capability';
import type { OfferManagerPort } from '../../domain/ports/offer-manager.port';
import { OfferCreationRecordRepositoryPort } from '../../domain/ports/offer-creation-record-repository.port';
import {
  BULK_BATCH_STATUS,
  type BulkBatchStatus,
} from '../../domain/types/bulk-listing-batch.types';
import { OFFER_CREATION_STATUS } from '../../domain/types/offer-creation-record.types';
import {
  BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN,
  BULK_LISTING_BATCH_REPOSITORY_TOKEN,
  OFFER_CREATION_RECORD_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type { IBulkListingRetryService } from '../interfaces/bulk-listing-retry.service.interface';
import type {
  BulkListingRetryAiFlags,
  BulkListingRetryResult,
} from '../types/bulk-listing-retry.types';

@Injectable()
export class BulkListingRetryService implements IBulkListingRetryService {
  private readonly logger = new Logger(BulkListingRetryService.name);

  constructor(
    @Inject(BULK_LISTING_BATCH_REPOSITORY_TOKEN)
    private readonly bulkBatchRepository: BulkListingBatchRepositoryPort,
    @Inject(OFFER_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly offerCreationRecords: OfferCreationRecordRepositoryPort,
    @Inject(BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN)
    private readonly advancementRepository: BulkBatchAdvancementRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  async retryFailed(batchId: string): Promise<BulkListingRetryResult> {
    // 1. Verify batch exists.
    const batch = await this.bulkBatchRepository.findById(batchId);
    if (!batch) {
      throw new BulkListingBatchNotFoundException(batchId);
    }

    // 2. Load children + filter to failed. `findByBulkBatchId` returns
    //    every child ordered by `createdAt ASC`, preserving the operator's
    //    original review-table order.
    const allChildren = await this.offerCreationRecords.findByBulkBatchId(batchId);
    const failedChildren = allChildren.filter(
      (r) => r.status === OFFER_CREATION_STATUS.Failed
    );
    if (failedChildren.length === 0) {
      throw new NoFailedChildrenToRetryException(batchId);
    }

    // 3. Adapter / capability check fail-fast (before any state mutation).
    //    Mirrors the submit service's upfront check so a downgraded
    //    connection fails identically across both phases. Domain exception
    //    keeps core NestJS-free — controller maps to 422.
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      batch.connectionId,
      'OfferManager'
    );
    if (!isOfferCreator(adapter)) {
      throw new AdapterCapabilityNotSupportedException(batch.connectionId, 'OfferCreator');
    }

    // 4. Rebuild AI flags from sharedConfig (snapshot doesn't carry them).
    //    Generate one retryWaveId per invocation; all retried children
    //    share it (for log correlation + the wave-distinct idempotency key).
    const aiFlags = this.extractAiFlags(batch.sharedConfig);
    const retryWaveId = randomUUID();

    this.logger.log(
      `Retrying ${failedChildren.length} failed records on batch ${batchId} (waveId=${retryWaveId})`
    );

    // 5. Fan out per record. Critical ordering — (a)→(b)→(c)→(d):
    //
    //      (a) deleteForRecord — open the advancement gate FIRST. If a
    //          crash before (d) leaves the gate open, the operator
    //          re-invokes retryFailed and the upstream `status='failed'`
    //          filter skips already-recovered rows.
    //      (b) resetForRetry — record back to 'pending'; clears
    //          externalOfferId / errors / classificationReport.
    //      (c) incrementCounters({ failed: -1 }) — per-record decrement,
    //          lock-stepped to (b) so partial-failure can't drift.
    //      (d) enqueueJob LAST — hand the job off only once local state
    //          is consistent. A throw here leaves state recoverable.
    //
    //    Sequential, not Promise.all — N is bounded by the submit-side
    //    `totalCount ≤ 100` cap, so worst-case is ~400 sequential awaits.
    //    If the submit cap lifts, revisit this loop.
    const retriedRecordIds: string[] = [];
    for (const record of failedChildren) {
      const snapshot = record.request;
      if (!snapshot) {
        // Documented invariant: every record on a bulk batch carries a
        // `request` snapshot. A null here is a backfill / migration / SQL
        // mistake — surface as a typed exception so the sync-job runner
        // classifies non-retryable (better than a silent skip + lying
        // batch summary).
        throw new BulkRetryMissingSnapshotException(record.id, batchId);
      }

      // (a) Open the advancement gate.
      await this.advancementRepository.deleteForRecord(batchId, record.id);
      // (b) Reset record to 'pending'.
      await this.offerCreationRecords.resetForRetry(record.id);
      // (c) Decrement failedCount in lock-step.
      await this.bulkBatchRepository.incrementCounters(batchId, { failed: -1 });

      // `satisfies` keeps the literal's structural shape — assignable to
      // `SyncJobRequest.payload`'s `Record<string, unknown>` without a cast.
      // (Annotating with the nominal interface would widen and force one.)
      // Mirrors the pattern in `OfferCreationEnqueueService`.
      const payload = {
        schemaVersion: 2 as const,
        internalVariantId: snapshot.internalVariantId,
        stock: snapshot.stock,
        publishImmediately: snapshot.publishImmediately,
        offerCreationRecordId: record.id,
        bulkBatchId: batchId,
        generateDescription: aiFlags.generateDescription,
        ...(snapshot.price !== undefined && { price: snapshot.price }),
        ...(snapshot.overrides !== undefined && { overrides: snapshot.overrides }),
        ...(aiFlags.descriptionTone !== undefined && {
          descriptionTone: aiFlags.descriptionTone,
        }),
      } satisfies MarketplaceOfferCreatePayloadV2;

      const idempotencyKey = `bulk:${batchId}:variant:${snapshot.internalVariantId}:retry:${retryWaveId}`;

      // (d) Hand the job off last.
      await this.jobEnqueue.enqueueJob({
        jobType: 'marketplace.offer.create',
        connectionId: batch.connectionId,
        idempotencyKey,
        payload,
      });

      retriedRecordIds.push(record.id);
    }

    // 6. Single status-flip after the loop if the batch was terminal.
    //    No intermediate flicker for the FE; idempotent no-op for already-running.
    if (this.isTerminalStatus(batch.status)) {
      await this.bulkBatchRepository.updateStatus(batchId, BULK_BATCH_STATUS.Running);
    }

    return {
      retriedCount: retriedRecordIds.length,
      retriedRecordIds,
      retryWaveId,
      batchStatus: BULK_BATCH_STATUS.Running,
    };
  }

  /**
   * Defensive read of the batch's sharedConfig JSONB. Non-boolean
   * `generateDescription` shapes default silently to `false`; unknown
   * `descriptionTone` strings log a WARN and drop to undefined (preserving
   * the retry rather than failing on a bad value).
   */
  private extractAiFlags(sharedConfig: Record<string, unknown>): BulkListingRetryAiFlags {
    const generateDescription = sharedConfig.generateDescription === true;

    const rawTone = sharedConfig.descriptionTone;
    let descriptionTone: OfferDescriptionTone | undefined;
    if (typeof rawTone === 'string') {
      if ((OfferDescriptionToneValues as readonly string[]).includes(rawTone)) {
        descriptionTone = rawTone as OfferDescriptionTone;
      } else {
        this.logger.warn(
          `Unknown descriptionTone in batch.sharedConfig: ${rawTone} — ignoring`
        );
      }
    }

    return { generateDescription, descriptionTone };
  }

  private isTerminalStatus(status: BulkBatchStatus): boolean {
    return (
      status === BULK_BATCH_STATUS.Completed ||
      status === BULK_BATCH_STATUS.PartiallyFailed ||
      status === BULK_BATCH_STATUS.Failed
    );
  }
}
