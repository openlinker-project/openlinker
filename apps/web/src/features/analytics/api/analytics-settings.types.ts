/**
 * Analytics display settings types
 *
 * Mirrors `apps/api/src/analytics/http/dto/analytics-settings-response.dto.ts`
 * and `update-analytics-settings.dto.ts` (#2461, epic #2452 Phase 3/6).
 *
 * `AnalyticsSettingsView.displayCurrency` is always a resolved, usable ISO
 * currency code — never `null` — because `GET /analytics/settings` composes
 * the operator-saved override with the system reporting currency server-side.
 * `displayCurrencySource` tells the caller which rung answered it: `'setting'`
 * (an explicit override exists) or `'default'` (falls back to the system
 * reporting currency).
 *
 * @module features/analytics/api
 */
export const RATE_BASIS_VALUES = ['current', 'order-date'] as const;
export type RateBasis = (typeof RATE_BASIS_VALUES)[number];

/** Default VAT basis a view opens in when no `?netGrossBasis=` URL override is present. */
export const NET_GROSS_BASIS_VALUES = ['gross', 'net'] as const;
export type NetGrossBasis = (typeof NET_GROSS_BASIS_VALUES)[number];

export const ANALYTICS_DISPLAY_CURRENCY_SOURCES = ['setting', 'default'] as const;
export type AnalyticsDisplayCurrencySource = (typeof ANALYTICS_DISPLAY_CURRENCY_SOURCES)[number];

export interface AnalyticsSettingsView {
  /** The resolved display currency: an operator-saved override, or the system reporting currency. Never `null`. */
  displayCurrency: string;
  /** Which rung answered `displayCurrency`. */
  displayCurrencySource: AnalyticsDisplayCurrencySource;
  /** How a multi-currency figure is recomputed for display: `current` (today's rate) or `order-date` (the rate stamped at ingestion). */
  rateBasis: RateBasis;
  /** Org-wide opt-in: admit a backfilled pre-rollout order into Net Sales. Never mutates any `order_records` row. */
  includeBackfilledTaxRatesInNetSales: boolean;
  /** Default basis a view opens in when no `?netGrossBasis=` URL override is present. */
  netGrossBasis: NetGrossBasis;
  /** ISO timestamp of the last write to the settings row. `null` when no row exists yet. */
  updatedAt: string | null;
  /** Id of the user who last wrote the settings row. `null` when no row exists yet. */
  updatedByUserId: string | null;
}

/** Request body for `PUT /analytics/settings` — all four fields are required; `displayCurrency: null` clears the override. */
export interface UpdateAnalyticsSettingsInput {
  displayCurrency: string | null;
  rateBasis: RateBasis;
  includeBackfilledTaxRatesInNetSales: boolean;
  netGrossBasis: NetGrossBasis;
}
