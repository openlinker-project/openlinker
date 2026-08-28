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
  JobOutcomeReasonValues,
  JobStatusValues,
  JobTypeValues,
  JobStatus,
  JobType,
} from '@openlinker/core/sync';
import type { JobOutcome, JobOutcomeReason } from '@openlinker/core/sync';

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

  @ApiPropertyOptional({
    enum: JobOutcomeReasonValues,
    nullable: true,
    description:
      'Stable machine-readable code further classifying `outcome` (#1689), e.g. `master_deleted` when a ' +
      'business_failure was caused by the source product being deleted at its master — distinguishing that ' +
      'from any other business failure. `null` when the outcome needs no finer classification.',
  })
  outcomeReason!: JobOutcomeReason | null;

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

  @ApiPropertyOptional({ nullable: true, description: 'Job payload' })
  payloadJson!: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, description: 'Idempotency key used for deduplication' })
  idempotencyKey!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Timestamp when worker locked the job' })
  lockedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Worker instance ID that locked the job' })
  lockedBy!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description:
      'Wall-clock milliseconds of the most recently COMPLETED attempt (#2611), measured around the handler ' +
      'call, so it INCLUDES any time that attempt spent waiting for a per-connection rate-limit slot. Not a ' +
      'total across retries, and not the time the job spent queued before it was claimed. Written atomically with the status transition ' +
      'that ended the attempt, so it always describes the same attempt as `status`, `outcome` and `lastError`. ' +
      '`null` when no attempt has completed yet, when the job was killed without executing, or for rows ' +
      'predating the column. Consumers must exclude `null` from averages rather than reading it as zero.',
  })
  lastAttemptDurationMs!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description:
      'Total milliseconds this job has been parked by penalty-free deferrals (#2613/#2617) - a destination ' +
      'throttling us, a destination that is unavailable, or a write refused because a peer held the lock. ' +
      'A deferral consumes no retry attempt, so this running total is what eventually ends the cycle: past ' +
      'the worker budget the job rejoins the ordinary retry ladder and can reach `dead`. A non-null value ' +
      'means a job sitting at `queued` is waiting on the destination, not stuck. `null` means never deferred.',
  })
  deferredTotalMs!: number | null;
}
