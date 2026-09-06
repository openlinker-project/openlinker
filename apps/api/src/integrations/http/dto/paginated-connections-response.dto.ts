/**
 * Paginated Connections Response DTO
 *
 * Response shape for `GET /connections?limit=&offset=` (#2937) — the
 * connections-list-page-only paged read. Every other caller of
 * `GET /connections` (the command palette, capability pickers, lookup
 * tables) omits `limit`/`offset` and keeps receiving the bare
 * `ConnectionResponseDto[]` this endpoint has always returned; see
 * `ConnectionController.list` for the branch that decides which shape a
 * given request gets.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { ConnectionResponseDto } from './connection-response.dto';

export class PaginatedConnectionsResponseDto {
  @ApiProperty({ type: [ConnectionResponseDto] })
  items!: ConnectionResponseDto[];

  @ApiProperty({ description: 'Total number of connections matching the filters' })
  total!: number;

  @ApiProperty({ description: 'Page size used for this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset used for this response' })
  offset!: number;
}
