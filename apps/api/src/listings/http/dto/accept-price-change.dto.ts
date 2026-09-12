/**
 * Accept Price Change DTO (#3145)
 *
 * @module apps/api/src/listings/http/dto
 */
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AcceptPriceChangeDto {
  @ApiPropertyOptional({
    description:
      "Also set this (source, connection) pair's sync mode to `automatic` (mockup's single-accept-dialog opt-in checkbox).",
  })
  @IsOptional()
  @IsBoolean()
  optInAutomatic?: boolean;

  /**
   * REQUIRED (#3162 re-review, BLOCKING): `accept` publishes
   * `episode.computedNewAmount`, a value that MOVES on re-detection —
   * omitting the staleness guard would let a caller (a stale FE bundle,
   * curl, MCP) publish a price the operator never actually saw. #2610's
   * rule is that the refusal must be server-side, never only in a browser
   * form; this is that refusal, enforced by `class-validator` before the
   * request ever reaches `IPriceChangesService`.
   */
  @ApiProperty({
    description:
      "The episode version last seen by the caller — the staleness guard. Required: `accept` publishes a value (`computedNewAmount`) that can move out from under the caller between read and write, so this cannot be optional the way `EditPriceChangeDto`'s is. A mismatch is rejected with 409.",
  })
  @IsNotEmpty()
  @IsString()
  expectedVersion!: string;
}
