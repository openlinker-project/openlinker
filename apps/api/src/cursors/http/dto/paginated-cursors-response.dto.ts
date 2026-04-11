/**
 * Paginated Cursors Response DTO
 *
 * Response shape for GET /cursors.
 *
 * @module apps/api/src/cursors/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { CursorResponseDto } from './cursor-response.dto';

export class PaginatedCursorsResponseDto {
  @ApiProperty({ type: [CursorResponseDto] })
  items!: CursorResponseDto[];

  @ApiProperty({ description: 'Total number of cursors matching the filters' })
  total!: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
