/**
 * Shop Publish Response DTOs
 *
 * Response shapes for the shop-publish endpoints (#1044): the 202 submit
 * acknowledgements (single + bulk), the per-record status read (FE polling),
 * and the bulk-batch summary (FE batch tracker).
 *
 * @module apps/api/src/listings/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BulkBatchStatus, ListingCreationStatus } from '@openlinker/core/listings';
import type { ListingCreationError } from '@openlinker/core/listings';

export class ShopPublishResponseDto {
  @ApiProperty({ description: 'Enqueued sync-job id.' })
  jobId!: string;

  @ApiProperty({ description: 'Pre-created listing-creation record id (poll for status).' })
  listingCreationRecordId!: string;
}

export class ListingCreationRecordResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  internalVariantId!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty({ enum: ['pending', 'draft', 'published', 'failed'] })
  status!: ListingCreationStatus;

  @ApiProperty({ nullable: true })
  externalProductId!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Parent bulk-batch id, when part of a bulk submission.',
  })
  bulkBatchId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'array', items: { type: 'object' } })
  errors!: ListingCreationError[] | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class BulkShopPublishItemDto {
  @ApiProperty()
  internalVariantId!: string;

  @ApiProperty()
  jobId!: string;

  @ApiProperty()
  listingCreationRecordId!: string;
}

export class BulkShopPublishResponseDto {
  @ApiProperty()
  batchId!: string;

  @ApiProperty({ type: [BulkShopPublishItemDto] })
  items!: BulkShopPublishItemDto[];
}

export class BulkShopPublishBatchSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty({ enum: ['pending', 'running', 'completed', 'partially-failed', 'failed'] })
  status!: BulkBatchStatus;

  @ApiProperty()
  totalCount!: number;

  @ApiProperty()
  succeededCount!: number;

  @ApiProperty()
  failedCount!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ type: [ListingCreationRecordResponseDto] })
  records!: ListingCreationRecordResponseDto[];
}
