/**
 * Analytics Display Settings Service Interface
 *
 * Contract for the DB-backed analytics display preferences service. Mirrors
 * `IPosthogSettingsService`'s read/write shape (same context), minus the
 * credentials-store methods this setting has no equivalent of.
 *
 * @module libs/core/src/analytics/application/services
 */
import type {
  AnalyticsDisplaySettingsInput,
  AnalyticsDisplaySettingsView,
} from '../../domain/types/analytics-display-settings.types';

export interface IAnalyticsDisplaySettingsService {
  /**
   * Read the current settings. When no row has ever been saved, returns the
   * documented defaults (`displayCurrency: null`, `rateBasis: 'current'`,
   * `includeBackfilledTaxRatesInNetSales: false`) with `updatedAt` /
   * `updatedByUserId` both `null`.
   */
  getSettings(): Promise<AnalyticsDisplaySettingsView>;

  /** Idempotently persist the three settings fields. */
  updateSettings(input: AnalyticsDisplaySettingsInput, actorUserId?: string): Promise<void>;
}
