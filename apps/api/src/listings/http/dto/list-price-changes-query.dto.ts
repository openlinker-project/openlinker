/**
 * List Price Changes Query DTO (#3145)
 *
 * Query parameters for GET /listings/price-changes. Maps 1:1 to the
 * mockup's filter chips (`#filter-conn-*`, `#filter-direction-*`,
 * `#filter-magnitude-large`).
 *
 * `limit`/`offset` (#3162 review — BLOCKING): the underlying read was
 * unbounded (`findOpenAll`/`findOpenForConnection` ended in a bare
 * `getMany()` with every row's variant/product/connection hydrated) — a
 * real defect at catalogue scale, since a single supplier price-file import
 * across a 20k-SKU catalogue with two destinations can open on the order of
 * tens of thousands of open episodes. Defaults/bounds mirror
 * `list-products-query.dto.ts`.
 *
 * @module apps/api/src/listings/http/dto
 */
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListPriceChangesQueryDto {
  @ApiPropertyOptional({ description: 'Restrict to one destination connection.' })
  @IsOptional()
  @IsString()
  connectionId?: string;

  @ApiPropertyOptional({ enum: ['up', 'down'], description: 'Restrict to price increases or decreases.' })
  @IsOptional()
  @IsIn(['up', 'down'])
  direction?: 'up' | 'down';

  @ApiPropertyOptional({
    description: 'Restrict to changes of 10% or more in either direction (the "Big changes" chip).',
  })
  @IsOptional()
  // Query params arrive as strings — mirror list-orders-query.dto.ts's boolean
  // coercion so a stray value (`?magnitudeLarge=banana`) 400s instead of
  // silently applying the filter (#3162 review: `@IsOptional()` alone lets
  // `whitelist: true` pass the raw string through untyped, which the
  // repository then tests as truthy).
  @Transform(({ value }): unknown => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  magnitudeLarge?: boolean;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of items to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
