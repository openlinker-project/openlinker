/**
 * List Stream Dead Letters Query DTO
 *
 * Query parameters for GET /sync/stream-dead-letters (#2301, D48). All
 * fields are optional.
 *
 * @module apps/api/src/sync/http/dto
 */
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListStreamDeadLettersQueryDto {
  @ApiPropertyOptional({ description: 'Filter by Redis Stream name (e.g. "jobs.sync")' })
  @IsOptional()
  @IsString()
  stream?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of items to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
