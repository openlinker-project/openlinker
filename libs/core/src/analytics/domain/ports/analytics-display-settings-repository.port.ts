/**
 * Analytics Display Settings Repository Port
 *
 * Persistence contract for the singleton-row `analytics_display_settings`
 * table. Implemented by `AnalyticsDisplaySettingsRepository` in the
 * infrastructure layer; consumed by `AnalyticsDisplaySettingsService`.
 * Mirrors `PosthogSettingsRepositoryPort` (same context).
 *
 * @module libs/core/src/analytics/domain/ports
 */
import type { AnalyticsDisplaySettings } from '../entities/analytics-display-settings.entity';
import type { AnalyticsDisplaySettingsInput } from '../types/analytics-display-settings.types';

export interface AnalyticsDisplaySettingsRepositoryPort {
  /**
   * Read the singleton row. Returns `null` when no row exists yet — callers
   * are expected to fall back to the documented defaults.
   */
  findSettings(): Promise<AnalyticsDisplaySettings | null>;

  /**
   * Idempotently upsert the settings fields on the singleton row. Creates
   * the row if absent.
   */
  upsertSettings(
    input: AnalyticsDisplaySettingsInput,
    updatedByUserId: string | null
  ): Promise<AnalyticsDisplaySettings>;
}
