/**
 * Top Products Query DTO
 *
 * Query parameters for `GET /analytics/top-products` (#1988). Mirrors
 * `SalesAnalyticsQueryDto`'s required `from`/`to` + optional
 * `sourceConnectionId`, and adds sort dimension + `limit`/`offset` pagination
 * (the `list-offer-mappings-query.dto.ts` convention).
 *
 * @module apps/api/src/analytics/http/dto
 */
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TopProductSortByValues, type TopProductSortBy } from '@openlinker/core/orders';

export class TopProductsQueryDto {
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

  @ApiPropertyOptional({
    enum: TopProductSortByValues,
    default: 'revenue',
    description: 'Rank by comparable (reporting-currency) revenue, or by units sold.',
  })
  @IsOptional()
  @IsIn(TopProductSortByValues)
  sortBy?: TopProductSortBy = 'revenue';

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
