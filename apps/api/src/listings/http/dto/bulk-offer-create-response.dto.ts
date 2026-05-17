/**
 * Bulk Offer Create Response DTOs (#736)
 *
 * Response shapes for `POST /listings/bulk-create` (202) and
 * `GET /listings/bulk-create/:batchId` (200). The progress endpoint's
 * shape — batch row + per-product record summary — matches what the
 * wizard's batch-progress page (#741) consumes directly.
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BulkBatchStatusValues, OfferCreationStatusValues } from '@openlinker/core/listings';

export class BulkOfferCreateResponseDto {
  @ApiProperty({ description: 'Persisted batch id (UUID).', format: 'uuid' })
  batchId!: string;

  @ApiProperty({
    description:
      'Redis Streams message ids, one per enqueued marketplace.offer.create job. Positional with the request `productIds` array.',
    type: [String],
  })
  jobIds!: string[];
}

export class BulkBatchRecordSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'OL internal variant id.' })
  internalVariantId!: string;

  @ApiProperty({ enum: OfferCreationStatusValues })
  status!: (typeof OfferCreationStatusValues)[number];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Marketplace-native offer id once the platform create call succeeds.',
  })
  externalOfferId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class BulkBatchSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  connectionId!: string;

  @ApiProperty({ enum: BulkBatchStatusValues })
  status!: (typeof BulkBatchStatusValues)[number];

  @ApiProperty()
  totalCount!: number;

  @ApiProperty()
  succeededCount!: number;

  @ApiProperty()
  failedCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({
    description: 'Per-product child records, ordered by `createdAt ASC`.',
    type: [BulkBatchRecordSummaryDto],
  })
  records!: BulkBatchRecordSummaryDto[];
}
