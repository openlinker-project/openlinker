/**
 * Get Exchange Rate DTO
 *
 * Query parameters for `GET /currency/rates` (#2778).
 *
 * `from`/`to` are bare `@IsString()`, mirroring `SetReportingCurrencyDto`'s
 * own precedent — the registry's actual key space is whatever a provider has
 * ever published, which this DTO cannot enumerate, so a well-formed-but-absent
 * pair is a 404 from the lookup rather than a 400 the DTO layer would have to
 * pre-guess.
 *
 * @module apps/api/src/currency/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class GetExchangeRateDto {
  @ApiProperty({ description: 'ISO-4217, the unit being priced.', example: 'EUR' })
  @IsString()
  @IsNotEmpty()
  from!: string;

  @ApiProperty({ description: 'ISO-4217, the unit the price is expressed in.', example: 'PLN' })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({ description: 'The published day, ISO YYYY-MM-DD.', example: '2026-08-29' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be a calendar date (YYYY-MM-DD)' })
  date!: string;
}
