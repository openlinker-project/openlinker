/**
 * Analytics Display Settings Service
 *
 * Implements `IAnalyticsDisplaySettingsService`. All three fields
 * (`displayCurrency`, `rateBasis`, `includeBackfilledTaxRatesInNetSales`)
 * live on the singleton `analytics_display_settings` table — there is no
 * env-var fallback rung, unlike `PosthogSettingsService` /
 * `ReportingCurrencySettingsService`: these are pure operator preferences
 * with no pre-existing env-configured deployment to stay compatible with.
 *
 * Read-through model: `getSettings()` hits the repository on every call —
 * no in-process cache, mirroring the other singleton-settings services in
 * this repo (a cache would need an invalidator port pointing back at
 * whichever module writes it, for a read that is already a
 * primary-key lookup).
 *
 * @module libs/core/src/analytics/application/services
 * @implements {IAnalyticsDisplaySettingsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { ANALYTICS_DISPLAY_SETTINGS_REPOSITORY_TOKEN } from '../../analytics.tokens';
import { AnalyticsDisplaySettingsRepositoryPort } from '../../domain/ports/analytics-display-settings-repository.port';
import type {
  AnalyticsDisplaySettingsInput,
  AnalyticsDisplaySettingsView,
} from '../../domain/types/analytics-display-settings.types';
import type { IAnalyticsDisplaySettingsService } from './analytics-display-settings.service.interface';

@Injectable()
export class AnalyticsDisplaySettingsService implements IAnalyticsDisplaySettingsService {
  private readonly logger = new Logger(AnalyticsDisplaySettingsService.name);

  constructor(
    @Inject(ANALYTICS_DISPLAY_SETTINGS_REPOSITORY_TOKEN)
    private readonly repository: AnalyticsDisplaySettingsRepositoryPort
  ) {}

  async getSettings(): Promise<AnalyticsDisplaySettingsView> {
    const row = await this.repository.findSettings();

    if (!row) {
      return {
        displayCurrency: null,
        rateBasis: 'current',
        includeBackfilledTaxRatesInNetSales: false,
        netGrossBasis: 'gross',
        updatedAt: null,
        updatedByUserId: null,
      };
    }

    return {
      displayCurrency: row.displayCurrency,
      rateBasis: row.rateBasis,
      includeBackfilledTaxRatesInNetSales: row.includeBackfilledTaxRatesInNetSales,
      netGrossBasis: row.netGrossBasis,
      updatedAt: row.updatedAt,
      updatedByUserId: row.updatedByUserId,
    };
  }

  async updateSettings(input: AnalyticsDisplaySettingsInput, actorUserId?: string): Promise<void> {
    await this.repository.upsertSettings(input, actorUserId ?? null);
    this.logger.log('analytics_display_settings.update', {
      displayCurrency: input.displayCurrency,
      rateBasis: input.rateBasis,
      includeBackfilledTaxRatesInNetSales: input.includeBackfilledTaxRatesInNetSales,
      netGrossBasis: input.netGrossBasis,
      actor: actorUserId ?? 'system',
    });
  }
}
