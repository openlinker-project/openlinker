/**
 * Sync Job Group DTO
 *
 * Response row for `GET /sync/jobs/grouped`. Each group aggregates all
 * jobs sharing a `(connectionId, jobType)` signature into a single row.
 *
 * @module apps/api/src/sync/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { JobTypeValues } from '@openlinker/core/sync';
import { JobType } from '@openlinker/core/sync';

export class SyncJobGroupDto {
  @ApiProperty({ description: 'Connection ID shared by all jobs in the group' })
  connectionId!: string;

  @ApiProperty({ enum: JobTypeValues, description: 'Job type shared by all jobs in the group' })
  jobType!: JobType;

  @ApiProperty({ description: 'Number of jobs in this group' })
  count!: number;

  @ApiProperty({ description: 'Most recent updatedAt across the group (ISO 8601)' })
  latestUpdatedAt!: string;

  @ApiProperty({ description: 'ID of the most-recently-updated job in the group' })
  representativeJobId!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Last error from the representative row; may be null if the job never failed with a message',
  })
  lastError!: string | null;
}
