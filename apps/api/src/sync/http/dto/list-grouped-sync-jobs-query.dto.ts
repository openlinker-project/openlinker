/**
 * List Grouped Sync Jobs Query DTO
 *
 * Query parameters for `GET /sync/jobs/grouped`. `status` is required (the
 * endpoint is intentionally scoped — callers must pick a status); `connectionId`
 * narrows to a single connection; `limit` caps the groups array.
 *
 * @module apps/api/src/sync/http/dto
 */
import { IsEnum, IsOptional, IsUUID, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobStatusValues } from '@openlinker/core/sync';
import type { JobStatus } from '@openlinker/core/sync';

export class ListGroupedSyncJobsQueryDto {
  @ApiProperty({ enum: JobStatusValues, description: 'Job status to aggregate' })
  @IsEnum(JobStatusValues)
  status!: JobStatus;

  @ApiPropertyOptional({ description: 'Filter by connection ID (UUID)' })
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @ApiPropertyOptional({
    default: 100,
    minimum: 1,
    maximum: 100,
    description: 'Maximum number of groups to return',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 100;
}
