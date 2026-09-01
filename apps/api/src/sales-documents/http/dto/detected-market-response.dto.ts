/**
 * Detected Market Response DTOs (#2518, ADR-066)
 *
 * The wire shape of the market-discovery read: which countries orders arrived
 * from over a window, and how many. It is what turns "you have no routing"
 * into "47 orders here are waiting", which is the fact an operator can act on.
 *
 * Deliberately carries NO `configured` flag, no `hasTemplate` flag and no
 * severity. Classification is the caller's job (ADR-066 decision 1): the
 * settings page joins these rows against `GET /sales-documents/countries` and
 * against the curated templates itself, because two sources of truth for "is
 * this market set up" is the drift the routing-first redesign exists to
 * remove. And a detected, unconfigured market is a NEUTRAL state, not a fault -
 * a fresh install is not broken, so nothing here is named `missing` or
 * `problem` for a surface to tint red.
 *
 * @module apps/api/src/sales-documents/http/dto
 * @see docs/architecture/adrs/066-sales-document-market-discovery.md
 */
import { ApiProperty } from '@nestjs/swagger';

export class DetectedMarketDto {
  @ApiProperty({
    description:
      'ISO 3166-1 alpha-2 as the order carried it, verbatim - never normalised or mapped to a display ' +
      'name here, because the value has to stay comparable with what a rule was authored against.',
    example: 'PL',
  })
  country!: string;

  @ApiProperty({
    description: 'Orders from that country within the window. Always at least 1 - a zero row cannot exist.',
    example: 47,
  })
  orderCount!: number;
}

export class DetectedMarketsResponseDto {
  @ApiProperty({
    description:
      'The window actually applied, in days. Travels with the response so a surface can say "in the ' +
      'last N days" without holding its own copy of the number and drifting from it. A documented ' +
      'constant, not a per-operator setting (ADR-066).',
    example: 30,
  })
  windowDays!: number;

  @ApiProperty({
    description: 'ISO-8601 lower bound the counts were taken from, inclusive.',
    example: '2026-07-31T10:00:00.000Z',
  })
  since!: string;

  @ApiProperty({
    type: [DetectedMarketDto],
    description:
      'Detected markets, most orders first. A country with configured routing and one without are ' +
      'BOTH returned. Empty on an instance that has ingested no orders in the window - a legitimate ' +
      'brand-new-install state, not an error.',
  })
  markets!: DetectedMarketDto[];
}
