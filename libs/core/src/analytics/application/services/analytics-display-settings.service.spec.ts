/**
 * Analytics Display Settings Service — Unit Tests
 *
 * Mocks the settings repo only — this service has no env-var fallback rung
 * and no credentials store, unlike its sibling `PosthogSettingsService`.
 *
 * @module libs/core/src/analytics/application/services
 */
import { Logger as SharedLogger } from '@openlinker/shared/logging';
import { AnalyticsDisplaySettings } from '../../domain/entities/analytics-display-settings.entity';
import type { AnalyticsDisplaySettingsRepositoryPort } from '../../domain/ports/analytics-display-settings-repository.port';
import { AnalyticsDisplaySettingsService } from './analytics-display-settings.service';

describe('AnalyticsDisplaySettingsService', () => {
  let repository: jest.Mocked<AnalyticsDisplaySettingsRepositoryPort>;
  let logSpy: jest.SpyInstance;
  let service: AnalyticsDisplaySettingsService;

  beforeEach(() => {
    repository = {
      findSettings: jest.fn(),
      upsertSettings: jest.fn(),
    };
    logSpy = jest.spyOn(SharedLogger.prototype, 'log').mockImplementation(() => undefined);
    service = new AnalyticsDisplaySettingsService(repository);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('getSettings', () => {
    it('returns documented defaults with no timestamps when no row exists', async () => {
      repository.findSettings.mockResolvedValue(null);

      const view = await service.getSettings();

      expect(view).toEqual({
        displayCurrency: null,
        rateBasis: 'current',
        includeBackfilledTaxRatesInNetSales: false,
        netGrossBasis: 'gross',
        updatedAt: null,
        updatedByUserId: null,
      });
    });

    it('returns the persisted row verbatim', async () => {
      const updatedAt = new Date('2026-08-20T10:00:00Z');
      repository.findSettings.mockResolvedValue(
        new AnalyticsDisplaySettings('EUR', 'order-date', true, 'net', updatedAt, 'user-9')
      );

      const view = await service.getSettings();

      expect(view).toEqual({
        displayCurrency: 'EUR',
        rateBasis: 'order-date',
        includeBackfilledTaxRatesInNetSales: true,
        netGrossBasis: 'net',
        updatedAt,
        updatedByUserId: 'user-9',
      });
    });
  });

  describe('updateSettings', () => {
    it('delegates to the repository with the resolved actor', async () => {
      repository.upsertSettings.mockResolvedValue(
        new AnalyticsDisplaySettings('PLN', 'current', false, 'gross', new Date(), 'user-1')
      );

      await service.updateSettings(
        {
          displayCurrency: 'PLN',
          rateBasis: 'current',
          includeBackfilledTaxRatesInNetSales: false,
          netGrossBasis: 'gross',
        },
        'user-1'
      );

      expect(repository.upsertSettings).toHaveBeenCalledWith(
        {
          displayCurrency: 'PLN',
          rateBasis: 'current',
          includeBackfilledTaxRatesInNetSales: false,
          netGrossBasis: 'gross',
        },
        'user-1'
      );
    });

    it('passes a null actor for a system-driven write', async () => {
      repository.upsertSettings.mockResolvedValue(
        new AnalyticsDisplaySettings(null, 'current', false, 'gross', new Date(), null)
      );

      await service.updateSettings({
        displayCurrency: null,
        rateBasis: 'current',
        includeBackfilledTaxRatesInNetSales: false,
        netGrossBasis: 'gross',
      });

      expect(repository.upsertSettings).toHaveBeenCalledWith(
        {
          displayCurrency: null,
          rateBasis: 'current',
          includeBackfilledTaxRatesInNetSales: false,
          netGrossBasis: 'gross',
        },
        null
      );
    });
  });
});
