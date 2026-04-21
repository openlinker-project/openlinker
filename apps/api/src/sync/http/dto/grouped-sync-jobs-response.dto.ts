/**
 * Grouped Sync Jobs Response DTO
 *
 * Response shape for `GET /sync/jobs/grouped`. `groups` is capped at the
 * caller's `limit`; `totalGroups` exposes the true count so the UI can
 * render "top N of M signatures".
 *
 * @module apps/api/src/sync/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { SyncJobGroupDto } from './sync-job-group.dto';

export class GroupedSyncJobsResponseDto {
  @ApiProperty({ type: [SyncJobGroupDto] })
  groups!: SyncJobGroupDto[];

  @ApiProperty({ description: 'Total distinct (connectionId, jobType) groups matching the filter' })
  totalGroups!: number;

  @ApiProperty({ description: 'Total jobs matching the filter across all groups' })
  totalJobs!: number;
}
