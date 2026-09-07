/**
 * Exchange Rate Response DTO
 *
 * Response body for `GET /currency/rates` (#2778) — the registry row exactly
 * as stored, so a converted figure on `/analytics` can be traced back to what
 * produced it: the value, the day it was published for, the publisher, how it
 * was derived, and the publisher's own document reference where it has one.
 *
 * Never a statutory rate — see ADR-040's own warning about the FA(3)
 * `KursWaluty` distinction.
 *
 * @module apps/api/src/currency/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { StoredExchangeRate } from '@openlinker/core/currency';

export class ExchangeRateResponseDto {
  @ApiProperty({ description: 'ISO-4217, the unit being priced.' })
  from!: string;

  @ApiProperty({ description: 'ISO-4217, the unit the price is expressed in.' })
  to!: string;

  @ApiProperty({
    type: String,
    description:
      'to units per one from unit, as a string — never Number()’d, matching the ' +
      'numeric(18,8) registry column this figure is audited against. ' +
      'Analytics provenance only; never a statutory/fiscal conversion rate (ADR-040).',
  })
  rate!: string;

  @ApiProperty({ description: 'The day the source published this rate for, ISO YYYY-MM-DD.' })
  rateDate!: string;

  @ApiProperty({ description: "Which publisher this rate came from, e.g. 'nbp' or 'ecb'." })
  source!: string;

  @ApiProperty({
    enum: ['direct', 'inverted', 'pivot'],
    description: 'How the stored rate was obtained from the source’s own published quotes.',
  })
  derivation!: 'direct' | 'inverted' | 'pivot';

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The source's own document reference (e.g. NBP's table number 149/A/NBP/2026), " +
      'or null — ECB assigns none.',
  })
  sourceRef!: string | null;

  static fromDomain(stored: StoredExchangeRate): ExchangeRateResponseDto {
    const dto = new ExchangeRateResponseDto();
    dto.from = stored.from;
    dto.to = stored.to;
    dto.rate = stored.rate;
    dto.rateDate = stored.rateDate;
    dto.source = stored.source;
    dto.derivation = stored.derivation.kind;
    dto.sourceRef = stored.sourceRef;
    return dto;
  }
}
