/**
 * Enqueue Sync Job DTO
 *
 * Request DTO for enqueuing a sync job. Validates job type, connection ID,
 * payload, and idempotency key.
 *
 * @module apps/api/src/sync/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, IsObject, IsNotEmpty, IsIn } from 'class-validator';
import { JobTypeValues } from '@openlinker/core/sync';

/**
 * Enqueue Sync Job Request
 *
 * Request body for POST /sync/jobs endpoint.
 */
export class EnqueueSyncJobDto {
  @ApiProperty({
    description: 'Job type identifier',
    enum: JobTypeValues,
    example: 'marketplace.orders.poll',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(JobTypeValues, {
    message: `jobType must be one of: ${JobTypeValues.join(', ')}`,
  })
  jobType!: string;

  @ApiProperty({
    description:
      'Connection identifier (UUID). A deployment-wide job such as ' +
      '`fulfillment.work.relaySweep` takes the nil UUID ' +
      '`00000000-0000-0000-0000-000000000000`, exactly as the scheduler enqueues it.',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  // `'all'`, not `'4'` (#3506, G02-4): system-scoped jobs run under the nil UUID
  // `SYSTEM_CONNECTION_ID` (worker scheduler), which no v4 pattern accepts. A
  // hand-made v4-shaped stand-in enqueues the job under a DIFFERENT scope id,
  // and the handler's per-run lock is keyed on that id — so a manual run and the
  // cron would stop excluding each other.
  @IsUUID('all', { message: 'connectionId must be a valid UUID' })
  connectionId!: string;

  @ApiProperty({
    description: 'Job payload (provider-specific data)',
    example: { schemaVersion: 1, cursorKey: 'allegro.orders.lastEventId', limit: 10 },
  })
  @IsObject({ message: 'payload must be an object' })
  payload!: Record<string, unknown>;

  @ApiProperty({
    description: 'Idempotency key for deduplication (format: {provider}:{connectionId}:{eventId})',
    example: 'marketplace:123e4567-e89b-12d3-a456-426614174000:orders:poll-2024-01-01-12-00',
  })
  @IsString()
  @IsNotEmpty({ message: 'idempotencyKey is required' })
  idempotencyKey!: string;
}

