/**
 * Tax Coverage Orders Query DTO
 *
 * Query parameters for `GET /analytics/coverage/tax/orders` (#2474, Phase 7)
 * — `AnalyticsCoverageQueryDto`'s window plus a `category` selector and real
 * pagination, mirroring `CurrencyMismatchOrdersQueryDto`. Added alongside the
 * FE Data Coverage panel because the mockup's `detail-tax` / `detail-novat` /
 * `detail-postrollout` modals need a scrollable list, not the aggregate's
 * fixed 10-id sample — `ITaxCoverageDetectionService.getCategoryPage`
 * already accepted `CoverageDetectionPagination`; only the HTTP surface was
 * missing.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { TaxCoverageCategoryValues, type TaxCoverageCategory } from '@openlinker/core/orders';

export class TaxCoverageOrdersQueryDto {
  @ApiProperty({ enum: TaxCoverageCategoryValues, description: 'Which A/B/C sub-category to list.' })
  @IsNotEmpty()
  @IsIn(TaxCoverageCategoryValues)
  category!: TaxCoverageCategory;

  @ApiProperty({ description: 'Range start, inclusive (ISO 8601), bucketed by placedAt.' })
  @IsNotEmpty()
  @IsDateString()
  from!: string;

  @ApiProperty({ description: 'Range end, exclusive (ISO 8601), bucketed by placedAt.' })
  @IsNotEmpty()
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ description: 'Narrow to a single source connection (UUID).' })
  @IsOptional()
  @IsUUID()
  sourceConnectionId?: string;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
