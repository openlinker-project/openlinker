/**
 * Cursor Response DTO
 *
 * Response shape for a single connection cursor. Used in both list and detail responses.
 * Dates are serialised as ISO 8601 strings.
 *
 * @module apps/api/src/cursors/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class CursorResponseDto {
  @ApiProperty({ description: 'Connection ID (UUID)' })
  connectionId!: string;

  @ApiProperty({ description: 'Cursor key identifier (e.g., allegro.orders.lastEventId)' })
  cursorKey!: string;

  @ApiProperty({ description: 'Current cursor value' })
  value!: string;

  @ApiProperty({ description: 'First created timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last updated timestamp (ISO 8601)' })
  updatedAt!: string;
}
