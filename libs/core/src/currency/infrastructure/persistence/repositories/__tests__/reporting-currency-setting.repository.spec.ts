/**
 * Reporting Currency Setting Repository Tests
 *
 * @module libs/core/src/currency/infrastructure/persistence/repositories/__tests__
 */
import type { Repository } from 'typeorm';
import { REPORTING_CURRENCY_SETTING_SINGLETON_ID } from '../../../../domain/entities/reporting-currency-setting.entity';
import type { ReportingCurrencySettingOrmEntity } from '../../entities/reporting-currency-setting.orm-entity';
import { ReportingCurrencySettingRepository } from '../reporting-currency-setting.repository';

function ormRow(
  overrides: Partial<ReportingCurrencySettingOrmEntity> = {}
): ReportingCurrencySettingOrmEntity {
  return {
    id: REPORTING_CURRENCY_SETTING_SINGLETON_ID,
    reportingCurrency: 'PLN',
    updatedAt: new Date('2026-08-14T06:00:00Z'),
    updatedBy: 'user-1',
    ...overrides,
  } as ReportingCurrencySettingOrmEntity;
}

describe('ReportingCurrencySettingRepository', () => {
  let ormRepository: jest.Mocked<Repository<ReportingCurrencySettingOrmEntity>>;
  let repository: ReportingCurrencySettingRepository;

  beforeEach(() => {
    ormRepository = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      upsert: jest.fn(),
    } as unknown as jest.Mocked<Repository<ReportingCurrencySettingOrmEntity>>;
    repository = new ReportingCurrencySettingRepository(ormRepository);
  });

  describe('findSetting', () => {
    it('should read the fixed singleton id', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow());

      await repository.findSetting();

      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { id: REPORTING_CURRENCY_SETTING_SINGLETON_ID },
      });
    });

    it('should return null when no operator has ever set a reporting currency', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(repository.findSetting()).resolves.toBeNull();
    });

    it('should map the row onto the domain entity', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow());

      const setting = await repository.findSetting();

      expect(setting).toEqual({
        reportingCurrency: 'PLN',
        updatedAt: new Date('2026-08-14T06:00:00Z'),
        updatedBy: 'user-1',
      });
    });

    it('should return a stored value that is no longer in the supported set rather than throwing', async () => {
      // The supported set is a function of which providers are registered, so
      // it can legitimately shrink after a row was written. Throwing on the
      // read would turn a policy change into a boot failure.
      ormRepository.findOne.mockResolvedValue(ormRow({ reportingCurrency: 'USD' }));

      await expect(repository.findSetting()).resolves.toMatchObject({
        reportingCurrency: 'USD',
      });
    });
  });

  describe('upsertSetting', () => {
    it('should upsert on the id conflict path and re-read the row', async () => {
      ormRepository.findOneOrFail.mockResolvedValue(ormRow({ reportingCurrency: 'EUR' }));

      const saved = await repository.upsertSetting('EUR', 'user-2');

      expect(ormRepository.upsert).toHaveBeenCalledWith(
        {
          id: REPORTING_CURRENCY_SETTING_SINGLETON_ID,
          reportingCurrency: 'EUR',
          updatedBy: 'user-2',
        },
        { conflictPaths: ['id'] }
      );
      expect(saved.reportingCurrency).toBe('EUR');
    });

    it('should accept a null actor for a system-driven write', async () => {
      ormRepository.findOneOrFail.mockResolvedValue(ormRow({ updatedBy: null }));

      const saved = await repository.upsertSetting('PLN', null);

      expect(saved.updatedBy).toBeNull();
    });
  });
});
