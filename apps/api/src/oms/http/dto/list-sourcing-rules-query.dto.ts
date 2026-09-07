/**
 * List Sourcing Rules Query DTO (#2953)
 *
 * Query values arrive as strings, so `includeSuperseded` is transformed
 * explicitly rather than relying on `@IsBoolean` against `'true'`.
 *
 * @module apps/api/src/oms/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class ListSourcingRulesQueryDto {
  @ApiPropertyOptional({
    description:
      'Include rules RETIRED before now (`effectiveTo` in the past). A rule retiring in the ' +
      'future is still evaluated by the router and is always listed.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeSuperseded?: boolean;
}
