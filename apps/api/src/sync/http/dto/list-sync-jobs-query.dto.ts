/**
 * List Sync Jobs Query DTO
 *
 * Query parameters for GET /sync/jobs. All fields are optional.
 *
 * @module apps/api/src/sync/http/dto
 */
import { IsEnum, IsOptional, IsUUID, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { JobStatusValues, JobTypeValues } from '@openlinker/core/sync';
import type { JobStatus, JobType } from '@openlinker/core/sync';

export class ListSyncJobsQueryDto {
  @ApiPropertyOptional({ enum: JobStatusValues, description: 'Filter by job status' })
  @IsOptional()
  @IsEnum(JobStatusValues)
  status?: JobStatus;

  @ApiPropertyOptional({ description: 'Filter by connection ID (UUID)' })
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @ApiPropertyOptional({ enum: JobTypeValues, description: 'Filter by job type' })
  @IsOptional()
  @IsEnum(JobTypeValues)
  jobType?: JobType;

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
