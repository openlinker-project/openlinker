/**
 * Paginated Sync Jobs Response DTO
 *
 * Response shape for GET /sync/jobs.
 *
 * @module apps/api/src/sync/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { SyncJobResponseDto } from './sync-job-response.dto';

export class PaginatedSyncJobsResponseDto {
  @ApiProperty({ type: [SyncJobResponseDto] })
  items!: SyncJobResponseDto[];

  @ApiProperty({ description: 'Total number of jobs matching the filters' })
  total!: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
