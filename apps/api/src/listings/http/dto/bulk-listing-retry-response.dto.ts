/**
 * Bulk Offer Creation Retry Response DTO (#742)
 *
 * Wire shape returned by `POST /listings/bulk-create/:batchId/retry-failed`.
 * Mirrors the submit response's contract — `retriedRecordIds` is the
 * operator-actionable handle (FE polls those records for terminal
 * transitions), `retriedCount` is the convenience aggregate, `batchStatus`
 * tells the FE whether to flip its summary card.
 *
 * `retryWaveId` is intentionally NOT on the wire: it's used internally for
 * the idempotency-key composition + log correlation, but no FE/plugin
 * consumer exists today. Re-expose if a wave-history view materialises.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

import { BulkBatchStatusValues, type BulkBatchStatus } from '@openlinker/core/listings';

export class BulkListingRetryResponseDto {
  @ApiProperty({ description: 'Internal IDs of records re-enqueued, in original createdAt order.' })
  retriedRecordIds!: string[];

  @ApiProperty({ description: 'Count of records re-enqueued. Always > 0.' })
  retriedCount!: number;

  @ApiProperty({ enum: BulkBatchStatusValues, description: 'Post-retry batch status.' })
  batchStatus!: BulkBatchStatus;
}
