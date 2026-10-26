/**
 * Bulk Offer Creation Progress Service (#737)
 *
 * Worker-side state-machine for `BulkListingBatch`. Per
 * `architecture-overview.md § 7`, orchestration policies live in core
 * application services, not in worker handlers — so the terminal-status
 * derivation rule lives here, with the handler reduced to a thin shell
 * that calls `advanceBatchStatus` after each child terminates.
 *
 * Implements at-most-once advancement via
 * `BulkBatchAdvancementRepositoryPort.markAdvancedIfNotExists` (composite-PK
 * INSERT-ON-CONFLICT-DO-NOTHING) so retries + concurrent workers can't
 * double-increment the counters.
 *
 * `reclassifyChildAsFailed` (E2E-21) corrects a child that was counted as
 * `succeeded` when the marketplace accepted the create and then rejected the
 * offer asynchronously: the creation poller terminalises such a record as
 * `failed` minutes after the batch may already read COMPLETED. The
 * correction is gated the same way, by a conditional UPDATE on the
 * advancement row's recorded outcome, so a replayed poll never double-adjusts;
 * that gate and the counter move commit in one transaction, so a crash between
 * them cannot strand the batch one short of its total.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IBulkListingProgressService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { Logger } from '@openlinker/shared/logging';

import type { BulkListingBatch } from '../../domain/entities/bulk-listing-batch.entity';
import { BulkBatchAdvancementRepositoryPort } from '../../domain/ports/bulk-batch-advancement-repository.port';
import { BulkListingBatchRepositoryPort } from '../../domain/ports/bulk-listing-batch-repository.port';
import type { BulkChildOutcome } from '../../domain/types/bulk-child-outcome.types';
import {
  BULK_BATCH_STATUS,
  type BulkBatchStatus,
} from '../../domain/types/bulk-listing-batch.types';
import {
  BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN,
  BULK_LISTING_BATCH_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type { IBulkListingProgressService } from './bulk-listing-progress.service.interface';

@Injectable()
export class BulkListingProgressService implements IBulkListingProgressService {
  private readonly logger = new Logger(BulkListingProgressService.name);

  constructor(
    @Inject(BULK_LISTING_BATCH_REPOSITORY_TOKEN)
    private readonly bulkBatchRepository: BulkListingBatchRepositoryPort,
    @Inject(BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN)
    private readonly advancementRepository: BulkBatchAdvancementRepositoryPort
  ) {}

  async advanceBatchStatus(
    batchId: string,
    offerCreationRecordId: string,
    outcome: BulkChildOutcome
  ): Promise<BulkListingBatch | null> {
    const { created } = await this.advancementRepository.markAdvancedIfNotExists(
      batchId,
      offerCreationRecordId,
      outcome
    );
    if (!created) {
      this.logger.debug(
        `Skipping advance — already recorded. batchId=${batchId} recordId=${offerCreationRecordId}`
      );
      return null;
    }

    const delta = outcome === 'succeeded' ? { succeeded: 1 } : { failed: 1 };
    const batch = await this.bulkBatchRepository.incrementCounters(batchId, delta);
    return this.settleIfFinished(batchId, batch);
  }

  async reclassifyChildAsFailed(
    batchId: string,
    offerCreationRecordId: string
  ): Promise<BulkListingBatch | null> {
    const batch = await this.bulkBatchRepository.reclassifySucceededChildAsFailed(
      batchId,
      offerCreationRecordId
    );
    if (!batch) {
      // Not counted yet (the poller won a race against the create handler's
      // advance), already counted as failed, or a legacy row with no recorded
      // outcome. The first case needs the child counted as failed now - the
      // handler's later `succeeded` advance then dedupes on the existing row.
      // The other two are no-ops inside `advanceBatchStatus`.
      return this.advanceBatchStatus(batchId, offerCreationRecordId, 'failed');
    }

    this.logger.log(
      `Reclassified bulk child as failed after an asynchronous rejection. batchId=${batchId} recordId=${offerCreationRecordId}`
    );
    return this.settleIfFinished(batchId, batch);
  }

  /**
   * The single terminal-status rule (completed / partially-failed / failed),
   * shared by the first-time advance and the reclassification so the two
   * cannot drift. Returns `null` while children are still outstanding.
   */
  private async settleIfFinished(
    batchId: string,
    batch: BulkListingBatch
  ): Promise<BulkListingBatch | null> {
    const finished = batch.succeededCount + batch.failedCount === batch.totalCount;
    if (!finished) return null;

    const terminal: BulkBatchStatus =
      batch.failedCount === 0
        ? BULK_BATCH_STATUS.Completed
        : batch.succeededCount === 0
          ? BULK_BATCH_STATUS.Failed
          : BULK_BATCH_STATUS.PartiallyFailed;

    return this.bulkBatchRepository.updateStatus(batchId, terminal);
  }
}
