/**
 * Stream Dead Letters Count Response DTO
 *
 * Response shape for GET /sync/stream-dead-letters/count (#2301, D48).
 *
 * @module apps/api/src/sync/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class StreamDeadLettersCountResponseDto {
  @ApiProperty({ description: 'Total number of dead-lettered entries matching the filter' })
  count!: number;
}
