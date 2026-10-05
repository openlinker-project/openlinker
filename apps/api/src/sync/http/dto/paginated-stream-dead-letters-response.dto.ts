/**
 * Paginated Stream Dead Letters Response DTO
 *
 * Response shape for GET /sync/stream-dead-letters (#2301, D48).
 *
 * @module apps/api/src/sync/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { StreamDeadLetterResponseDto } from './stream-dead-letter-response.dto';

export class PaginatedStreamDeadLettersResponseDto {
  @ApiProperty({ type: [StreamDeadLetterResponseDto] })
  items!: StreamDeadLetterResponseDto[];

  @ApiProperty({ description: 'Total number of dead-lettered entries matching the filters' })
  total!: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
