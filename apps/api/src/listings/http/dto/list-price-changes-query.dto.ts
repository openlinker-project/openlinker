/**
 * List Price Changes Query DTO (#3145)
 *
 * Query parameters for GET /listings/price-changes. Maps 1:1 to the
 * mockup's filter chips (`#filter-conn-*`, `#filter-direction-*`,
 * `#filter-magnitude-large`).
 *
 * @module apps/api/src/listings/http/dto
 */
import { IsIn, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
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
  @Transform(({ value }): unknown => (value === 'true' ? true : value === 'false' ? false : value))
  magnitudeLarge?: boolean;
}
