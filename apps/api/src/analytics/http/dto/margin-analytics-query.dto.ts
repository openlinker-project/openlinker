/**
 * Margin Analytics Query DTOs
 *
 * Query parameters for `GET /analytics/margin*` (#3588). `from`/`to` are
 * required like every analytics read; the global validation pipe is
 * whitelist + forbidNonWhitelisted, so a parameter not declared here (for
 * example `displayCurrency`, which margin does not support) is a 400.
 *
 * @module apps/api/src/analytics/http/dto
 */
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MarginBucketValues,
  MarginSortByValues,
  type MarginBucket,
  type MarginSortBy,
} from '@openlinker/core/orders';

export class MarginRangeQueryDto {
  @ApiProperty({ description: 'Range start, inclusive (ISO 8601). Bucketed by placedAt.' })
  @IsNotEmpty()
  @IsDateString()
  from!: string;

  @ApiProperty({ description: 'Range end, exclusive (ISO 8601). Bucketed by placedAt.' })
  @IsNotEmpty()
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ description: 'Narrow to a single source connection (UUID)' })
  @IsOptional()
  @IsUUID()
  sourceConnectionId?: string;
}

export class MarginAnalyticsQueryDto extends MarginRangeQueryDto {
  @ApiPropertyOptional({
    enum: MarginBucketValues,
    default: 'day',
    description: 'Trend bucket: UTC day, or ISO week (UTC, Monday start).',
  })
  @IsOptional()
  @IsIn(MarginBucketValues)
  bucket?: MarginBucket = 'day';
}

export class MarginProductsQueryDto extends MarginRangeQueryDto {
  @ApiPropertyOptional({
    enum: MarginSortByValues,
    default: 'grossMargin',
    description:
      'Rank by gross margin, net revenue, or margin % (products with nothing covered sort last).',
  })
  @IsOptional()
  @IsIn(MarginSortByValues)
  sortBy?: MarginSortBy = 'grossMargin';

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of products to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
