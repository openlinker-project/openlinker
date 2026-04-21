/**
 * Retry Grouped Sync Jobs DTO
 *
 * Request body for `POST /sync/jobs/retry-grouped`. Selects the failure
 * signature to re-queue in bulk.
 *
 * @module apps/api/src/sync/http/dto
 */
import { IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JobTypeValues } from '@openlinker/core/sync';
import type { JobType } from '@openlinker/core/sync';

export class RetryGroupedSyncJobsDto {
  @ApiProperty({ description: 'Connection ID scoping the failure signature (UUID)' })
  @IsUUID()
  connectionId!: string;

  @ApiProperty({ enum: JobTypeValues, description: 'Job type scoping the failure signature' })
  @IsEnum(JobTypeValues)
  jobType!: JobType;
}
