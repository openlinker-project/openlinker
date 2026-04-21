/**
 * Retry Grouped Sync Jobs Response DTO
 *
 * Response shape for `POST /sync/jobs/retry-grouped`. `skipped` counts jobs
 * that flipped out of `dead` between our selection and the update (another
 * retry raced us, or a worker picked them up).
 *
 * @module apps/api/src/sync/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class RetryGroupedSyncJobsResponseDto {
  @ApiProperty({
    type: [String],
    description: 'IDs of jobs that were re-queued by this call',
  })
  requeuedJobIds!: string[];

  @ApiProperty({ description: 'Number of jobs re-queued (length of requeuedJobIds)' })
  count!: number;

  @ApiProperty({
    description: 'Number of jobs that were selected but not re-queued (flipped out of dead mid-flight)',
  })
  skipped!: number;
}
