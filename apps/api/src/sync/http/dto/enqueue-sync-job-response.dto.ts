/**
 * Enqueue Sync Job Response DTO
 *
 * Response DTO for POST /sync/jobs endpoint. Returns the job ID assigned
 * by the queue system.
 *
 * @module apps/api/src/sync/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

/**
 * Enqueue Sync Job Response
 *
 * Response body for POST /sync/jobs endpoint.
 */
export class EnqueueSyncJobResponseDto {
  @ApiProperty({
    description: 'Job ID assigned by the queue system',
    example: '1704110400000-0',
  })
  jobId!: string;

  @ApiProperty({
    description: 'Job type',
    example: 'allegro.orders.poll',
  })
  jobType!: string;

  @ApiProperty({
    description: 'Connection ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  connectionId!: string;

  @ApiProperty({
    description: 'Indicates if this is an existing job (idempotent)',
    example: false,
  })
  isExisting!: boolean;
}

