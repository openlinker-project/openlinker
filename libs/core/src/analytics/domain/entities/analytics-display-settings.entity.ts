/**
 * Analytics Display Settings Domain Entity
 *
 * Singleton-row representation of the DB-backed analytics display
 * preferences (display currency override, rate-recomputation basis, and the
 * backfilled-tax-rate Net Sales inclusion opt-in — #2461). Modeled on
 * `PosthogSettings` (same context, same `id = 'singleton'` shape) and on the
 * `ReportingCurrencySetting` / `AiProviderActiveSetting` precedents.
 *
 * @module libs/core/src/analytics/domain/entities
 */
import type { NetGrossBasis, RateBasis } from '../types/analytics-display-settings.types';

export const ANALYTICS_DISPLAY_SETTINGS_SINGLETON_ID = 'singleton';

export class AnalyticsDisplaySettings {
  constructor(
    public readonly displayCurrency: string | null,
    public readonly rateBasis: RateBasis,
    public readonly includeBackfilledTaxRatesInNetSales: boolean,
    public readonly netGrossBasis: NetGrossBasis,
    public readonly updatedAt: Date,
    public readonly updatedByUserId: string | null
  ) {}
}
