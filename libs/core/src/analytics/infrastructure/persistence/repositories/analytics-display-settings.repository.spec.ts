/**
 * Analytics Display Settings Repository Tests
 *
 * @module libs/core/src/analytics/infrastructure/persistence/repositories
 */
import type { Repository } from 'typeorm';
import { ANALYTICS_DISPLAY_SETTINGS_SINGLETON_ID } from '../../../domain/entities/analytics-display-settings.entity';
import type { AnalyticsDisplaySettingsOrmEntity } from '../entities/analytics-display-settings.orm-entity';
import { AnalyticsDisplaySettingsRepository } from './analytics-display-settings.repository';

function ormRow(
  overrides: Partial<AnalyticsDisplaySettingsOrmEntity> = {}
): AnalyticsDisplaySettingsOrmEntity {
  return {
    id: ANALYTICS_DISPLAY_SETTINGS_SINGLETON_ID,
    displayCurrency: 'PLN',
    rateBasis: 'current',
    includeBackfilledTaxRatesInNetSales: false,
    updatedAt: new Date('2026-08-14T06:00:00Z'),
    updatedByUserId: 'user-1',
    ...overrides,
  } as AnalyticsDisplaySettingsOrmEntity;
}

describe('AnalyticsDisplaySettingsRepository', () => {
  let ormRepository: jest.Mocked<Repository<AnalyticsDisplaySettingsOrmEntity>>;
  let repository: AnalyticsDisplaySettingsRepository;

  beforeEach(() => {
    ormRepository = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      upsert: jest.fn(),
    } as unknown as jest.Mocked<Repository<AnalyticsDisplaySettingsOrmEntity>>;
    repository = new AnalyticsDisplaySettingsRepository(ormRepository);
  });

  describe('findSettings', () => {
    it('should read the fixed singleton id', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow());

      await repository.findSettings();

      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { id: ANALYTICS_DISPLAY_SETTINGS_SINGLETON_ID },
      });
    });

    it('should return null when no operator has ever saved a row', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(repository.findSettings()).resolves.toBeNull();
    });

    it('should map the row onto the domain entity', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow());

      const settings = await repository.findSettings();

      expect(settings).toEqual({
        displayCurrency: 'PLN',
        rateBasis: 'current',
        includeBackfilledTaxRatesInNetSales: false,
        updatedAt: new Date('2026-08-14T06:00:00Z'),
        updatedByUserId: 'user-1',
      });
    });

    it('should map a null displayCurrency (use reporting currency)', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow({ displayCurrency: null }));

      const settings = await repository.findSettings();

      expect(settings?.displayCurrency).toBeNull();
    });

    it('should throw on an unrecognised rate_basis value rather than coerce silently', async () => {
      ormRepository.findOne.mockResolvedValue(
        ormRow({ rateBasis: 'not-a-real-basis' })
      );

      await expect(repository.findSettings()).rejects.toThrow(
        "analytics_display_settings.rate_basis has an unknown value 'not-a-real-basis'"
      );
    });
  });

  describe('upsertSettings', () => {
    it('should upsert on the id conflict path and re-read the row', async () => {
      ormRepository.findOneOrFail.mockResolvedValue(
        ormRow({ displayCurrency: 'EUR', rateBasis: 'order-date' })
      );

      const saved = await repository.upsertSettings(
        {
          displayCurrency: 'EUR',
          rateBasis: 'order-date',
          includeBackfilledTaxRatesInNetSales: true,
        },
        'user-2'
      );

      expect(ormRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: ANALYTICS_DISPLAY_SETTINGS_SINGLETON_ID,
          displayCurrency: 'EUR',
          rateBasis: 'order-date',
          includeBackfilledTaxRatesInNetSales: true,
          updatedByUserId: 'user-2',
        }),
        { conflictPaths: ['id'] }
      );
      expect(saved.displayCurrency).toBe('EUR');
      expect(saved.rateBasis).toBe('order-date');
    });

    it('should accept a null actor for a system-driven write', async () => {
      ormRepository.findOneOrFail.mockResolvedValue(ormRow({ updatedByUserId: null }));

      const saved = await repository.upsertSettings(
        {
          displayCurrency: null,
          rateBasis: 'current',
          includeBackfilledTaxRatesInNetSales: false,
        },
        null
      );

      expect(saved.updatedByUserId).toBeNull();
    });
  });
});
