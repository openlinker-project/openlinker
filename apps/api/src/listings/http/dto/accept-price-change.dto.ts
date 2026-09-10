/**
 * Accept Price Change DTO (#3145)
 *
 * @module apps/api/src/listings/http/dto
 */
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AcceptPriceChangeDto {
  @ApiPropertyOptional({
    description:
      "Also set this (source, connection) pair's sync mode to `automatic` (mockup's single-accept-dialog opt-in checkbox).",
  })
  @IsOptional()
  @IsBoolean()
  optInAutomatic?: boolean;

  @ApiPropertyOptional({
    description:
      'The episode version last seen by the caller — the staleness guard. Omitted means "accept whatever the server currently has" (used by the automatic-opt-in re-fetch flow); a mismatch is rejected with 409.',
  })
  @IsOptional()
  @IsString()
  expectedVersion?: string;
}
