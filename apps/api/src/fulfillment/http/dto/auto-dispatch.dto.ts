/**
 * Auto-Dispatch DTOs (#2729)
 *
 * Request and response shapes for the per-connection refusal read and the
 * settings preview. Responses carry only codes, ids and counts: a carrier's
 * error text can hold recipient detail, so it is never part of the contract.
 *
 * @module apps/api/src/fulfillment/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, Min, MinLength } from 'class-validator';

import {
  AutoDispatchRefusalBucketValues,
  type AutoDispatchRefusalBucket,
  type AutoDispatchRefusalCode,
} from '@openlinker/core/shipping';

import {
  AutoDispatchPreviewRefusalValues,
  type AutoDispatchHolderView,
  type AutoDispatchPreviewItem,
  type AutoDispatchPreviewRefusal,
  type AutoDispatchPreviewView,
  type AutoDispatchRefusalsView,
  type AutoDispatchRefusalView,
} from '../../application/interfaces/auto-dispatch-read.service.interface';

export const AUTO_DISPATCH_READ_DEFAULT_LIMIT = 50;
export const AUTO_DISPATCH_READ_MAX_LIMIT = 100;

export class AutoDispatchRefusalsQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: AUTO_DISPATCH_READ_MAX_LIMIT,
    default: AUTO_DISPATCH_READ_DEFAULT_LIMIT,
    description: 'Most recent refusals returned per bucket.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AUTO_DISPATCH_READ_MAX_LIMIT)
  limit?: number;
}

/**
 * The draft settings a preview is computed against. All optional: an empty
 * body previews the connection with no weight fallback, which is exactly what
 * an operator needs to see before they have typed one.
 */
export class AutoDispatchPreviewRequestDto {
  @ApiPropertyOptional({ description: 'Carrier size-template code, e.g. `small`.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  parcelTemplate?: string;

  @ApiPropertyOptional({ description: 'Fallback per-unit weight in grams.' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  defaultWeightGrams?: number;

  @ApiPropertyOptional({ description: 'Default parcel length in mm (set all three or none).' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  lengthMm?: number;

  @ApiPropertyOptional({ description: 'Default parcel width in mm.' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  widthMm?: number;

  @ApiPropertyOptional({ description: 'Default parcel height in mm.' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  heightMm?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: AUTO_DISPATCH_READ_MAX_LIMIT,
    default: 10,
    description: 'How many of the connection’s most recent orders to preview.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AUTO_DISPATCH_READ_MAX_LIMIT)
  limit?: number;
}

export class AutoDispatchHolderResponseDto implements AutoDispatchHolderView {
  @ApiProperty() connectionId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() platformType!: string;
  @ApiProperty({
    description:
      'Whether this connection can be assigned work at all. The settings belong to the ' +
      'connection that HOLDS the work, which is often the OpenLinker OMS or a 3PL rather than a ' +
      'carrier connection.',
  })
  holdsWork!: boolean;
  @ApiProperty() autoDispatchEnabled!: boolean;
}

export class AutoDispatchRefusalResponseDto implements AutoDispatchRefusalView {
  @ApiProperty() jobId!: string;
  @ApiProperty({ nullable: true, type: String }) workId!: string | null;
  @ApiProperty({ nullable: true, type: String }) orderId!: string | null;
  @ApiProperty({
    description:
      'Closed reason code (no-weight, no-dimensions, no-address, no-delivery-method, ' +
      'work-not-eligible, shipment-claimed-by-sibling-work, not-enabled, payload-invalid, ' +
      'carrier-refused) or `unknown` for a value this build does not recognise.',
  })
  code!: AutoDispatchRefusalCode;
  @ApiProperty({ enum: AutoDispatchRefusalBucketValues }) bucket!: AutoDispatchRefusalBucket;
  @ApiProperty({ type: String, format: 'date-time' }) since!: Date;
  @ApiProperty() attempts!: number;
  @ApiProperty() maxAttempts!: number;
}

export class AutoDispatchRefusalsResponseDto implements AutoDispatchRefusalsView {
  @ApiProperty({ type: AutoDispatchHolderResponseDto }) holder!: AutoDispatchHolderResponseDto;
  @ApiProperty({ type: [AutoDispatchRefusalResponseDto] })
  needsInput!: readonly AutoDispatchRefusalResponseDto[];
  @ApiProperty({ type: [AutoDispatchRefusalResponseDto] })
  retrying!: readonly AutoDispatchRefusalResponseDto[];
}

export class AutoDispatchPreviewDimensionsDto {
  @ApiProperty() length!: number;
  @ApiProperty() width!: number;
  @ApiProperty() height!: number;
}

export class AutoDispatchPreviewItemResponseDto implements AutoDispatchPreviewItem {
  @ApiProperty() workId!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ nullable: true, type: Number }) weightGrams!: number | null;
  @ApiProperty({ nullable: true, type: String }) template!: string | null;
  @ApiProperty({ nullable: true, type: AutoDispatchPreviewDimensionsDto })
  dimensions!: AutoDispatchPreviewDimensionsDto | null;
  @ApiProperty({
    nullable: true,
    enum: AutoDispatchPreviewRefusalValues,
    description: '`null` means the order would get a label with these settings.',
  })
  refusal!: AutoDispatchPreviewRefusal | null;
}

export class AutoDispatchPreviewResponseDto implements AutoDispatchPreviewView {
  @ApiProperty({ type: AutoDispatchHolderResponseDto }) holder!: AutoDispatchHolderResponseDto;
  @ApiProperty({ type: [AutoDispatchPreviewItemResponseDto] })
  items!: readonly AutoDispatchPreviewItemResponseDto[];
}
