/**
 * Ok Response DTO
 *
 * Generic `{ ok: true }` response for endpoints with no meaningful payload.
 *
 * @module apps/api/src/auth/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class OkResponseDto {
  @ApiProperty({ example: true })
  ok!: true;
}
