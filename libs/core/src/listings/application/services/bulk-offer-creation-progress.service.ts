/**
 * Bulk Offer Creation Progress Service (#737)
 *
 * Worker-side state-machine for `BulkOfferCreationBatch`. Per
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
 * @module libs/core/src/listings/application/services
 * @implements {IBulkOfferCreationProgressService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { Logger } from '@openlinker/shared/logging';

import type { BulkOfferCreationBatch } from '../../domain/entities/bulk-offer-creation-batch.entity';
import { BulkBatchAdvancementRepositoryPort } from '../../domain/ports/bulk-batch-advancement-repository.port';
import { BulkOfferCreationBatchRepositoryPort } from '../../domain/ports/bulk-offer-creation-batch-repository.port';
import {
  BULK_BATCH_STATUS,
  type BulkBatchStatus,
} from '../../domain/types/bulk-offer-creation-batch.types';
import {
  BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN,
  BULK_OFFER_CREATION_BATCH_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type { IBulkOfferCreationProgressService } from './bulk-offer-creation-progress.service.interface';

@Injectable()
export class BulkOfferCreationProgressService implements IBulkOfferCreationProgressService {
  private readonly logger = new Logger(BulkOfferCreationProgressService.name);

  constructor(
    @Inject(BULK_OFFER_CREATION_BATCH_REPOSITORY_TOKEN)
    private readonly bulkBatchRepository: BulkOfferCreationBatchRepositoryPort,
    @Inject(BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN)
    private readonly advancementRepository: BulkBatchAdvancementRepositoryPort
  ) {}

  async advanceBatchStatus(
    batchId: string,
    offerCreationRecordId: string,
    outcome: 'succeeded' | 'failed'
  ): Promise<BulkOfferCreationBatch | null> {
    const { created } = await this.advancementRepository.markAdvancedIfNotExists(
      batchId,
      offerCreationRecordId
    );
    if (!created) {
      this.logger.debug(
        `Skipping advance — already recorded. batchId=${batchId} recordId=${offerCreationRecordId}`
      );
      return null;
    }

    const delta = outcome === 'succeeded' ? { succeeded: 1 } : { failed: 1 };
    const batch = await this.bulkBatchRepository.incrementCounters(batchId, delta);

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
