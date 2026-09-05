/**
 * Product Matching Orders Query DTO
 *
 * Query parameters for `GET /analytics/coverage/matching/orders` (#2474,
 * Phase 7) — the `'product-matching'` category's paginated drill-down behind
 * the mockup's `detail-mapping` modal.
 *
 * Bucketed by `createdAt`, NOT `placedAt` — mirroring
 * `AnalyticsCoverageQueryDto`'s own split: an `awaiting_mapping` /
 * `source_deleted` order has no resolved `placedAt` yet (#1985 populates it
 * only for `recordStatus = 'ready'` records), so a `placedAt` filter would
 * silently exclude every row this category can ever contain.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ProductMatchingOrdersQueryDto {
  @ApiProperty({ description: 'Range start, inclusive (ISO 8601), bucketed by createdAt.' })
  @IsNotEmpty()
  @IsDateString()
  from!: string;

  @ApiProperty({ description: 'Range end, exclusive (ISO 8601), bucketed by createdAt.' })
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
