/**
 * Buyer Data Retention Preview DTOs (#4289)
 *
 * Request and response for the trial run. The request carries the rule to try
 * (not the stored one), so an operator can see the effect of a value before
 * saving it. Period bounds are re-checked by the service-level rules here, not
 * only by decorators.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import {
  BUYER_DATA_ERASE_MODES,
  BUYER_DATA_PERIOD_MAX_DAYS,
  type BuyerDataEraseMode,
} from '@openlinker/core/operational-settings';
import type {
  BuyerDataAgeHistogram,
  BuyerDataRetentionPreview,
  BuyerDataRetentionSample,
} from '@openlinker/core/orders';

export class BuyerDataRetentionPreviewRequestDto {
  @ApiPropertyOptional({
    description: 'Count only this connection. Absent = every connection.',
  })
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @ApiProperty({ description: 'Days until an order is hidden. 0 = never; otherwise 30 to 3650.' })
  @IsInt()
  @Min(0)
  @Max(BUYER_DATA_PERIOD_MAX_DAYS)
  hideAfterDays!: number;

  @ApiProperty({
    description: 'Days until personal data is erased. 0 = never; otherwise 30 to 3650.',
  })
  @IsInt()
  @Min(0)
  @Max(BUYER_DATA_PERIOD_MAX_DAYS)
  eraseAfterDays!: number;

  @ApiProperty({ enum: BUYER_DATA_ERASE_MODES })
  @IsIn([...BUYER_DATA_ERASE_MODES])
  mode!: BuyerDataEraseMode;
}

export class BuyerDataRetentionSampleDto {
  @ApiProperty() orderRef!: string;
  @ApiProperty({ description: 'ISO instant of the order date.' }) placedAt!: string;
  @ApiProperty({ description: 'A masked placeholder, never the buyer.' }) maskedBuyer!: string;
}

export class BuyerDataSkippedByReasonDto {
  @ApiProperty({ description: 'Skipped because of an open return.' }) openReturn!: number;
  @ApiProperty({ description: 'Skipped because of an open hold (and no open return).' })
  hold!: number;
  @ApiProperty({
    description: 'Skipped because an invoice is being issued (and no return or hold).',
  })
  invoicePending!: number;
}

export class BuyerDataRetentionPreviewResponseDto {
  @ApiProperty({ description: 'Orders that would be hidden.' }) toHide!: number;
  @ApiProperty({ description: 'Orders whose personal data would be erased.' }) toErase!: number;
  @ApiProperty({ description: 'Distinct orders that would be hidden or erased.' }) total!: number;
  @ApiProperty({
    description: 'Every order still on the list (not hidden) in scope, past the periods or not.',
  })
  totalOrders!: number;
  @ApiProperty({
    description:
      'Orders the rule would reach but skips: an open hold, an open return or a document being issued.',
  })
  skippedProtected!: number;

  @ApiProperty({
    type: BuyerDataSkippedByReasonDto,
    description:
      'skippedProtected split by reason. Each order is counted once, under the first matching reason (open return, hold, invoice pending), so the three sum to skippedProtected.',
  })
  skippedByReason!: BuyerDataSkippedByReasonDto;

  @ApiProperty({ type: [BuyerDataRetentionSampleDto], description: 'At most 5 masked examples.' })
  samples!: BuyerDataRetentionSample[];

  static fromPreview(preview: BuyerDataRetentionPreview): BuyerDataRetentionPreviewResponseDto {
    const dto = new BuyerDataRetentionPreviewResponseDto();
    dto.toHide = preview.toHide;
    dto.toErase = preview.toErase;
    dto.total = preview.total;
    dto.totalOrders = preview.totalOrders;
    dto.skippedProtected = preview.skippedProtected;
    dto.skippedByReason = { ...preview.skippedByReason };
    dto.samples = preview.samples.map((sample) => ({ ...sample }));
    return dto;
  }
}

export class BuyerDataAgeHistogramQueryDto {
  @ApiPropertyOptional({ description: 'Only this connection. Absent = every connection.' })
  @IsOptional()
  @IsUUID()
  connectionId?: string;
}

export class BuyerDataAgeBucketDto {
  @ApiProperty({ description: 'Age in 30-day months; 120 holds everything 120 and older.' })
  ageMonths!: number;
  @ApiProperty({ description: 'Orders not hidden.' }) visible!: number;
  @ApiProperty({ description: 'Hidden orders whose personal data is still present.' })
  hidden!: number;
  @ApiProperty({ description: 'Orders whose personal data was erased.' }) erased!: number;
}

export class BuyerDataAgeHistogramResponseDto {
  @ApiProperty({ enum: ['month'] }) bucketUnit!: 'month';
  @ApiProperty({ type: [BuyerDataAgeBucketDto], description: 'Dense: every month 0..max present.' })
  buckets!: BuyerDataAgeBucketDto[];
  @ApiProperty({ description: 'Every order in scope, hidden and erased included.' })
  totalOrders!: number;
  @ApiProperty({ type: String, nullable: true, description: 'ISO instant of the oldest order.' })
  oldestPlacedAt!: string | null;

  static fromHistogram(histogram: BuyerDataAgeHistogram): BuyerDataAgeHistogramResponseDto {
    const dto = new BuyerDataAgeHistogramResponseDto();
    dto.bucketUnit = histogram.bucketUnit;
    dto.buckets = histogram.buckets.map((bucket) => ({ ...bucket }));
    dto.totalOrders = histogram.totalOrders;
    dto.oldestPlacedAt = histogram.oldestPlacedAt;
    return dto;
  }
}
