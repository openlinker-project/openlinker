/**
 * Currency Settings Response DTO
 *
 * Response body for `GET /currency-settings`. Carries the resolved reporting
 * currency, WHICH RUNG produced it, the currencies a save would accept, the
 * coverage advisory for every one of those candidates, and how much history is
 * already stamped.
 *
 * Three of those are composed here rather than inside `currency`: the coverage
 * advisory and the stamped-row counts need `orders`, and composing two contexts
 * is legal in the interfaces layer only - doing it in the core service would
 * create a `currency -> orders` edge and cost that context its leaf property.
 *
 * The coverage advisory is returned for EVERY candidate, not just the currently
 * resolved one, because the operator-facing question is about a currency they
 * have not saved yet. It is a pure function of already-loaded data (a static
 * `supports` predicate over the observed set), so answering it for both
 * candidates costs one extra array pass and removes the need for a second
 * round-trip - which matters because the `PUT` answers 204 and therefore
 * carries no advisory of its own.
 *
 * @module apps/api/src/currency/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  REPORTING_CURRENCY_SOURCES,
  type ReportingCurrencyCoverage,
  type ReportingCurrencySettingsView,
  type ReportingCurrencySource,
} from '@openlinker/core/currency';
import type { StampedReportingCurrencyCount } from '@openlinker/core/orders';

export class StampedOrderCountDto {
  @ApiProperty({ description: 'The reporting currency these rows were stamped in.' })
  reportingCurrency!: string;

  @ApiProperty({ description: 'How many order rows carry that stamp.' })
  count!: number;

  static fromCount(count: StampedReportingCurrencyCount): StampedOrderCountDto {
    const dto = new StampedOrderCountDto();
    dto.reportingCurrency = count.reportingCurrency;
    dto.count = count.count;
    return dto;
  }
}

export class ReportingCurrencyCoverageDto {
  @ApiProperty({ description: 'The candidate reporting currency this advisory is about.' })
  reportingCurrency!: string;

  @ApiProperty({
    nullable: true,
    description:
      'The publisher that would serve this currency (`nbp` / `ecb`), or `null` when no provider is registered for it - in which case the advisory could not be computed and `uncoverableCurrencies` is empty for that reason, not because nothing is uncoverable.',
  })
  rateSource!: string | null;

  @ApiProperty({
    type: [String],
    description: 'Order-native currencies this deployment has already ingested.',
  })
  observedCurrencies!: string[];

  @ApiProperty({
    type: [String],
    description:
      'The observed currencies this candidate cannot be converted from. WARNS, NEVER BLOCKS - a save proceeds with `acknowledgeCoverageGaps`.',
  })
  uncoverableCurrencies!: string[];

  static fromCoverage(
    coverage: ReportingCurrencyCoverage,
    rateSource: string | null
  ): ReportingCurrencyCoverageDto {
    const dto = new ReportingCurrencyCoverageDto();
    dto.reportingCurrency = coverage.reportingCurrency;
    dto.rateSource = rateSource;
    dto.observedCurrencies = [...coverage.observedCurrencies];
    dto.uncoverableCurrencies = [...coverage.uncoverableCurrencies];
    return dto;
  }
}

export class CurrencySettingsResponseDto {
  @ApiProperty({
    description: 'The effective reporting currency every order total is additionally stamped in.',
  })
  reportingCurrency!: string;

  @ApiProperty({
    enum: REPORTING_CURRENCY_SOURCES,
    description:
      'Which rung answered: `setting` (an operator saved it), `env` (`OL_REPORTING_CURRENCY`), or `default` (nobody has chosen). The default CONVERTS, so it has to announce itself.',
  })
  source!: ReportingCurrencySource;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When the settings row was last written. `null` on the env / default rungs.',
  })
  updatedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Who last wrote the settings row. `null` on the env / default rungs.',
  })
  updatedBy!: string | null;

  @ApiProperty({
    type: [String],
    description:
      'The currencies a `PUT` would accept right now. The UI feeds its `<select>` from this, which is what makes the 400 / 422 paths unreachable from the frontend.',
  })
  supportedCurrencies!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The publisher serving the resolved currency, or `null` when the resolved value has no registered provider.',
  })
  rateSource!: string | null;

  @ApiProperty({ description: 'The rule deciding which published day a stamp reads.' })
  rateDateRule!: string;

  @ApiProperty({
    type: [StampedOrderCountDto],
    description:
      'Already-stamped rows per reporting currency. Empty means nothing is stamped and a change costs nothing; more than one entry means this deployment already holds several reporting-currency eras.',
  })
  stampedOrders!: StampedOrderCountDto[];

  @ApiProperty({
    type: [ReportingCurrencyCoverageDto],
    description: 'One coverage advisory per selectable currency.',
  })
  coverage!: ReportingCurrencyCoverageDto[];

  static fromView(input: {
    view: ReportingCurrencySettingsView;
    rateSource: string | null;
    rateDateRule: string;
    stampedOrders: readonly StampedReportingCurrencyCount[];
    coverage: readonly ReportingCurrencyCoverageDto[];
  }): CurrencySettingsResponseDto {
    const dto = new CurrencySettingsResponseDto();
    dto.reportingCurrency = input.view.reportingCurrency;
    dto.source = input.view.source;
    dto.updatedAt = input.view.updatedAt ? input.view.updatedAt.toISOString() : null;
    dto.updatedBy = input.view.updatedBy;
    dto.supportedCurrencies = [...input.view.supportedCurrencies];
    dto.rateSource = input.rateSource;
    dto.rateDateRule = input.rateDateRule;
    dto.stampedOrders = input.stampedOrders.map((count) => StampedOrderCountDto.fromCount(count));
    dto.coverage = [...input.coverage];
    return dto;
  }
}
