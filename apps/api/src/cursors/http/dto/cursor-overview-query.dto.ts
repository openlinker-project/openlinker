/**
 * Cursor Overview Query DTO (#4023)
 *
 * Query parameters for GET /cursors/overview.
 *
 * @module apps/api/src/cursors/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class CursorOverviewQueryDto {
  @ApiPropertyOptional({
    description:
      "Read only this connection's cursors (UUID). Use it when the full overview reports `truncated`.",
  })
  @IsOptional()
  @IsUUID('4')
  connectionId?: string;
}
