/**
 * Update Analytics Settings DTO
 *
 * Request body for `PUT /analytics/settings`. Validates all three
 * `analytics_display_settings` fields (#2461) — a display-currency override,
 * the rate-recomputation basis, and the backfilled-tax-rate Net Sales
 * inclusion opt-in.
 *
 * `displayCurrency` reuses the existing `SUPPORTED_REPORTING_CURRENCIES`
 * closed set from `@openlinker/core/currency` (ADR-040) rather than forking
 * a parallel currency-code validator: an override that is not itself a
 * reachable reporting currency could never be resolved to a rate, so the
 * same closed set the reporting-currency setting validates against is the
 * correct gate here too. `null` clears the override (falls back to the
 * system reporting currency).
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, ValidateIf } from 'class-validator';
import {
  NetGrossBasisValues,
  RateBasisValues,
  type NetGrossBasis,
  type RateBasis,
} from '@openlinker/core/analytics';
import { SUPPORTED_REPORTING_CURRENCIES } from '@openlinker/core/currency';

export class UpdateAnalyticsSettingsDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: `ISO-4217 display-currency override, narrowed to the reportable set: ${SUPPORTED_REPORTING_CURRENCIES.join(', ')}. \`null\` uses the system reporting currency.`,
    example: 'PLN',
  })
  @ValidateIf((_, value) => value !== null)
  @IsIn(SUPPORTED_REPORTING_CURRENCIES as unknown as string[])
  displayCurrency!: string | null;

  @ApiProperty({
    enum: RateBasisValues,
    description:
      "How a multi-currency figure is recomputed for display: `current` (today's rate) or `order-date` (the rate stamped at ingestion).",
  })
  @IsIn(RateBasisValues as unknown as string[])
  rateBasis!: RateBasis;

  @ApiProperty({
    description:
      'Org-wide opt-in: admit a pre-rollout order into Net Sales once a backfilled tax rate is resolved for it. Never mutates any order_records row — it only changes how existing rows are read/aggregated for Net Sales.',
  })
  @IsBoolean()
  includeBackfilledTaxRatesInNetSales!: boolean;

  @ApiProperty({
    enum: NetGrossBasisValues,
    description:
      "Default VAT basis a view opens in when no `?netGrossBasis=` URL override is present: `gross` (VAT-inclusive) or `net` (VAT-exclusive, NOV).",
  })
  @IsIn(NetGrossBasisValues as unknown as string[])
  netGrossBasis!: NetGrossBasis;
}
