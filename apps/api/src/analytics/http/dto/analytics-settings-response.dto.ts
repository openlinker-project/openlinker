/**
 * Analytics Settings Response DTO
 *
 * Response body for `GET /analytics/settings`. Composes the singleton
 * `analytics_display_settings` row (#2461) with the system reporting
 * currency (`@openlinker/core/currency`) so `displayCurrency` is always a
 * resolved, usable value — never `null` — while `displayCurrencySource`
 * tells the caller whether that value is an operator-saved override
 * (`'setting'`) or the system default (`'default'`).
 *
 * The shape deliberately mirrors `ReportingCurrencySettingsView.source`
 * (`@openlinker/core/currency`, ADR-040): a resolved value paired with a
 * provenance discriminator, rather than shipping the raw nullable field and
 * making every consumer re-derive "is this a default" client-side. There is
 * no `'env'` rung here (unlike the reporting-currency source) — these three
 * fields have no env-var fallback, only `row -> default`.
 *
 * Composed in the interfaces layer, not inside the `analytics` core module:
 * resolving the system reporting currency needs `@openlinker/core/currency`,
 * and adding that edge to core `analytics` would cost `currency` nothing but
 * would grow a cross-context dependency for a purely presentational read.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  NetGrossBasisValues,
  RateBasisValues,
  type AnalyticsDisplaySettingsView,
  type NetGrossBasis,
  type RateBasis,
} from '@openlinker/core/analytics';

/** Which rung answered `displayCurrency`: an operator-saved row, or the system default. */
export const ANALYTICS_DISPLAY_CURRENCY_SOURCES = ['setting', 'default'] as const;
export type AnalyticsDisplayCurrencySource = (typeof ANALYTICS_DISPLAY_CURRENCY_SOURCES)[number];

export class AnalyticsSettingsResponseDto {
  @ApiProperty({
    description:
      'The resolved display currency: the operator-saved override when one exists, otherwise the system reporting currency. Never null.',
  })
  displayCurrency!: string;

  @ApiProperty({
    enum: ANALYTICS_DISPLAY_CURRENCY_SOURCES,
    description:
      "Which rung answered `displayCurrency`: `setting` (an operator saved an override) or `default` (falls back to the system reporting currency). Mirrors `ReportingCurrencySettingsView.source`.",
  })
  displayCurrencySource!: AnalyticsDisplayCurrencySource;

  @ApiProperty({
    enum: RateBasisValues,
    description:
      "How a multi-currency figure is recomputed for display: `current` (today's rate) or `order-date` (the rate stamped at ingestion).",
  })
  rateBasis!: RateBasis;

  @ApiProperty({
    description:
      'Org-wide opt-in: admit a pre-rollout order into Net Sales once a backfilled tax rate is resolved for it (ADR-063 amendment). Never mutates any order_records row.',
  })
  includeBackfilledTaxRatesInNetSales!: boolean;

  @ApiProperty({
    enum: NetGrossBasisValues,
    description:
      "Default VAT basis a view opens in when no `?netGrossBasis=` URL override is present: `gross` (VAT-inclusive) or `net` (VAT-exclusive, NOV).",
  })
  netGrossBasis!: NetGrossBasis;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When the settings row was last written. `null` when no row exists yet.',
  })
  updatedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Who last wrote the settings row. `null` when no row exists yet.',
  })
  updatedByUserId!: string | null;

  static fromView(input: {
    view: AnalyticsDisplaySettingsView;
    resolvedReportingCurrency: string;
  }): AnalyticsSettingsResponseDto {
    const dto = new AnalyticsSettingsResponseDto();
    const hasExplicitOverride = input.view.displayCurrency !== null;
    dto.displayCurrency = hasExplicitOverride
      ? (input.view.displayCurrency as string)
      : input.resolvedReportingCurrency;
    dto.displayCurrencySource = hasExplicitOverride ? 'setting' : 'default';
    dto.rateBasis = input.view.rateBasis;
    dto.includeBackfilledTaxRatesInNetSales = input.view.includeBackfilledTaxRatesInNetSales;
    dto.netGrossBasis = input.view.netGrossBasis;
    dto.updatedAt = input.view.updatedAt ? input.view.updatedAt.toISOString() : null;
    dto.updatedByUserId = input.view.updatedByUserId;
    return dto;
  }
}
