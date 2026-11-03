/**
 * Stream Dead Letter Response DTO
 *
 * Response shape for one `stream_dead_letters` row (#2301, D48).
 *
 * @module apps/api/src/sync/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class StreamDeadLetterResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Redis Stream name (e.g. "jobs.sync")' })
  stream!: string;

  @ApiProperty({ description: 'Redis consumer group name' })
  consumerGroup!: string;

  @ApiProperty({ description: 'The Redis Stream entry id (e.g. "1234567890-0")' })
  entryId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description:
      'The raw field/value pairs as read from XRANGE/XPENDING — exactly the entry\'s own ' +
      'payload, never a typed reconstruction.',
  })
  rawFields!: Record<string, string>;

  @ApiProperty({ description: 'How many recovery attempts had failed when this was recorded' })
  attempts!: number;

  @ApiProperty({ description: 'The error message from the last failed recovery attempt' })
  lastError!: string;

  @ApiProperty({ description: 'When this entry was first recorded here' })
  firstSeenAt!: string;

  @ApiProperty({ description: 'When this entry was last (re-)recorded here' })
  lastSeenAt!: string;
}
