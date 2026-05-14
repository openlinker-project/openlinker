/**
 * Sync Job Response DTO
 *
 * Response shape for a single sync job. Used in both list and detail responses.
 * Dates are serialised as ISO 8601 strings.
 *
 * @module apps/api/src/sync/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  JobOutcomeValues,
  JobStatusValues,
  JobTypeValues,
  JobStatus,
  JobType,
} from '@openlinker/core/sync';
import type { JobOutcome } from '@openlinker/core/sync';

export class SyncJobResponseDto {
  @ApiProperty({ description: 'Job UUID' })
  id!: string;

  @ApiProperty({ enum: JobTypeValues, description: 'Job type identifier' })
  jobType!: JobType;

  @ApiProperty({ description: 'Connection UUID this job belongs to' })
  connectionId!: string;

  @ApiProperty({ enum: JobStatusValues, description: 'Current job status' })
  status!: JobStatus;

  @ApiPropertyOptional({
    enum: JobOutcomeValues,
    nullable: true,
    description:
      'Business outcome of the job (only set on the succeeded path). `ok` = business operation succeeded; `business_failure` = orchestration ran cleanly but the business operation was rejected terminally (e.g. marketplace validation failed). `null` for queued / running / dead jobs and historical rows pre-dating issue #400.',
  })
  outcome!: JobOutcome | null;

  @ApiProperty({ description: 'Number of execution attempts so far' })
  attempts!: number;

  @ApiProperty({ description: 'Maximum allowed attempts before marking dead' })
  maxAttempts!: number;

  @ApiProperty({ description: 'Timestamp when job is eligible to run (ISO 8601)' })
  nextRunAt!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Last error message if job failed' })
  lastError!: string | null;

  @ApiProperty({ description: 'Job creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Job last-update timestamp (ISO 8601)' })
  updatedAt!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Job payload (admin only)' })
  payloadJson!: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, description: 'Idempotency key used for deduplication' })
  idempotencyKey!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Timestamp when worker locked the job' })
  lockedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Worker instance ID that locked the job' })
  lockedBy!: string | null;
}
