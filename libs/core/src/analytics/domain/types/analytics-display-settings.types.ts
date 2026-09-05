/**
 * Analytics Display Settings Types
 *
 * Value types for the DB-backed analytics display preferences (#2461, epic
 * #2452 Phase 3). These are read-time preferences layered on top of the
 * order-level reporting-currency stamp (`@openlinker/core/currency`) — none
 * of the three fields here is the reporting currency itself, and none is
 * ever written back onto `order_records`.
 *
 * @module libs/core/src/analytics/domain/types
 */

/**
 * How a multi-currency figure is recomputed for display.
 *
 * - `'current'` — recompute using today's exchange rate.
 * - `'order-date'` — use the rate that applied when each order was placed
 *   (the same rate the #2124 FX stamp already persisted).
 */
export const RateBasisValues = ['current', 'order-date'] as const;
export type RateBasis = (typeof RateBasisValues)[number];

/**
 * Which basis a currency-denominated figure is shown in.
 *
 * - `'gross'` — VAT-inclusive (the pre-existing default; every figure's
 *   raw, as-charged amount).
 * - `'net'` — VAT-exclusive (NOV — see `SalesAnalyticsHeadline.netRevenue`).
 *
 * This is a read-time DISPLAY preference only, same as `rateBasis` — it
 * never changes which figures the backend computes (both are already
 * returned on every headline/channel row), only which one a view treats as
 * primary.
 */
export const NetGrossBasisValues = ['gross', 'net'] as const;
export type NetGrossBasis = (typeof NetGrossBasisValues)[number];

/**
 * Non-secret settings fields, as written by `PUT /analytics/settings` (#2462).
 */
export interface AnalyticsDisplaySettingsInput {
  /**
   * ISO-4217 display currency override, or `null` to use the system
   * reporting currency (`IReportingCurrencySettingsService.resolve()`) as the
   * display default — the mockup's `native` state.
   */
  displayCurrency: string | null;
  rateBasis: RateBasis;
  /**
   * Org-wide opt-in: admit a `taxRateEra = 'pre-rollout'` order into Net
   * Sales once `TaxRateBackfillService` has resolved a real rate for it (see
   * ADR-063's amendment for #2456). Default `false` — behaviour is
   * unchanged from the pre-#2456 exclusion until an operator opts in.
   */
  includeBackfilledTaxRatesInNetSales: boolean;
  /** Default basis a view opens in when no `?netGrossBasis=` URL override is present. Default `'gross'`. */
  netGrossBasis: NetGrossBasis;
}

/**
 * Read view returned by `GET /analytics/settings` (#2462).
 */
export interface AnalyticsDisplaySettingsView extends AnalyticsDisplaySettingsInput {
  /** `null` when no operator has ever saved a row yet (the defaults above apply). */
  updatedAt: Date | null;
  updatedByUserId: string | null;
}
