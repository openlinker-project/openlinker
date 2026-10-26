/**
 * Edit Price Change DTO (#3145)
 *
 * @module apps/api/src/listings/http/dto
 */
import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A generous ceiling that comfortably fits the `price_change_episodes`
 * columns' `numeric(14,4)` precision (#3162 re-review, SUGGESTION) — before
 * this, a value like `1e30` passed `@IsNumber()`/`@IsPositive()` and failed
 * only at the database as an unhandled 500. Not currency-aware (the DTO has
 * no access to the episode's `sourceCurrency`), so it bounds pathological
 * input rather than expressing a real per-currency limit.
 */
const MAX_MANUAL_PRICE_OVERRIDE = 1_000_000_000;

export class EditPriceChangeDto {
  @ApiProperty({ description: 'The operator-pinned price to publish instead of the rule-computed one.' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  @Max(MAX_MANUAL_PRICE_OVERRIDE)
  manualPriceOverride!: number;

  @ApiPropertyOptional({ description: "Also set this (source, connection) pair's sync mode to `automatic`." })
  @IsOptional()
  @IsBoolean()
  optInAutomatic?: boolean;

  /**
   * Deliberately OPTIONAL, unlike `AcceptPriceChangeDto.expectedVersion`
   * (#3162 re-review, BLOCKING finding's stated exception): `edit` publishes
   * an ABSOLUTE, operator-typed number (`manualPriceOverride`), not a value
   * that can silently drift the way `accept`'s `computedNewAmount` can, so
   * omitting the staleness check here cannot publish a price the operator
   * never intended. The `isOpen`/`blockReason` checks still apply
   * unconditionally regardless of whether this is supplied.
   */
  @ApiPropertyOptional({ description: 'The episode version last seen by the caller — the staleness guard.' })
  @IsOptional()
  @IsString()
  expectedVersion?: string;
}
