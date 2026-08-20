/**
 * Reporting Currency Settings Service Tests
 *
 * @module libs/core/src/currency/application/services/__tests__
 */
import type { ConfigService } from '@nestjs/config';
import { Logger } from '@openlinker/shared/logging';
import { ReportingCurrencySetting } from '../../../domain/entities/reporting-currency-setting.entity';
import {
  InvalidReportingCurrencyError,
  ReportingCurrencyUnsupportedError,
} from '../../../domain/exceptions/reporting-currency.exception';
import type { ExchangeRateProviderPort } from '../../../domain/ports/exchange-rate-provider.port';
import type { ExchangeRateProviderRegistryPort } from '../../../domain/ports/exchange-rate-provider-registry.port';
import type { ReportingCurrencySettingRepositoryPort } from '../../../domain/ports/reporting-currency-setting-repository.port';
import type { ExchangeRateSource } from '../../../domain/types/exchange-rate.types';
import { ReportingCurrencySettingsService } from '../reporting-currency-settings.service';

function stubProvider(
  name: ExchangeRateSource,
  currencies: readonly string[]
): ExchangeRateProviderPort {
  return {
    name,
    pivotCurrency: null,
    supports: () => true,
    listSupportedCurrencies: () => currencies,
    fetchRate: () => Promise.reject(new Error('not called')),
  };
}

describe('ReportingCurrencySettingsService', () => {
  let repository: jest.Mocked<ReportingCurrencySettingRepositoryPort>;
  let registry: jest.Mocked<ExchangeRateProviderRegistryPort>;
  let configService: jest.Mocked<ConfigService>;
  let warn: jest.SpyInstance;

  function buildService(): ReportingCurrencySettingsService {
    return new ReportingCurrencySettingsService(repository, registry, configService);
  }

  beforeEach(() => {
    repository = {
      findSetting: jest.fn().mockResolvedValue(null),
      upsertSetting: jest.fn(),
    };
    registry = {
      register: jest.fn(),
      get: jest.fn(),
      has: jest.fn().mockReturnValue(true),
      list: jest
        .fn()
        .mockReturnValue([
          stubProvider('nbp', ['PLN', 'EUR', 'USD']),
          stubProvider('ecb', ['EUR', 'PLN', 'USD']),
        ]),
    };
    configService = { get: jest.fn().mockReturnValue(undefined) } as unknown as jest.Mocked<
      ConfigService
    >;
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('resolve', () => {
    it('should return the persisted row when one exists', async () => {
      repository.findSetting.mockResolvedValue(
        new ReportingCurrencySetting('PLN', new Date('2026-08-14T06:00:00Z'), 'user-1')
      );

      await expect(buildService().resolve()).resolves.toBe('PLN');
    });

    it('should fall back to OL_REPORTING_CURRENCY when no row exists', async () => {
      configService.get.mockReturnValue('PLN');

      await expect(buildService().resolve()).resolves.toBe('PLN');
    });

    it('should normalise a lowercase, padded env value', async () => {
      configService.get.mockReturnValue('  pln  ');

      await expect(buildService().resolve()).resolves.toBe('PLN');
    });

    it('should fall back to the default when neither a row nor an env value exists', async () => {
      await expect(buildService().resolve()).resolves.toBe('EUR');
    });

    it('should prefer the row over the env value', async () => {
      configService.get.mockReturnValue('PLN');
      repository.findSetting.mockResolvedValue(
        new ReportingCurrencySetting('EUR', new Date(), null)
      );

      await expect(buildService().resolve()).resolves.toBe('EUR');
    });
  });

  describe('env fallback validation', () => {
    it('should ignore a malformed env value and fall back to the default', async () => {
      configService.get.mockReturnValue('not-a-currency');

      await expect(buildService().resolve()).resolves.toBe('EUR');
    });

    it('should ignore a well-formed but unsupported env value', async () => {
      configService.get.mockReturnValue('USD');

      await expect(buildService().resolve()).resolves.toBe('EUR');
    });

    it('should never throw at boot on a bad env value', async () => {
      configService.get.mockReturnValue('%%%');

      await expect(buildService().resolve()).resolves.toBe('EUR');
    });

    it('should warn exactly once however many times resolve is called', async () => {
      // resolve() runs on every stamp attempt, so a warn per call would bury
      // the log under one line per order while telling the operator nothing new.
      configService.get.mockReturnValue('USD');
      const service = buildService();

      await service.resolve();
      await service.resolve();
      await service.getView();

      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('should not warn for a valid env value', async () => {
      configService.get.mockReturnValue('PLN');

      await buildService().resolve();

      expect(warn).not.toHaveBeenCalled();
    });

    it('should not warn for an absent env value', async () => {
      await buildService().resolve();

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('getView', () => {
    it("should report source 'setting' with the audit fields when a row exists", async () => {
      const updatedAt = new Date('2026-08-14T06:00:00Z');
      repository.findSetting.mockResolvedValue(
        new ReportingCurrencySetting('PLN', updatedAt, 'user-1')
      );

      await expect(buildService().getView()).resolves.toEqual({
        reportingCurrency: 'PLN',
        source: 'setting',
        updatedAt,
        updatedBy: 'user-1',
        supportedCurrencies: ['PLN', 'EUR'],
      });
    });

    it("should report source 'env' with null audit fields", async () => {
      configService.get.mockReturnValue('PLN');

      await expect(buildService().getView()).resolves.toMatchObject({
        reportingCurrency: 'PLN',
        source: 'env',
        updatedAt: null,
        updatedBy: null,
      });
    });

    it("should report source 'default' with null audit fields", async () => {
      // `source !== 'setting'` is what the frontend renders as `EUR (default)` -
      // the discriminator, rather than comparing against a hardcoded 'EUR'.
      await expect(buildService().getView()).resolves.toMatchObject({
        reportingCurrency: 'EUR',
        source: 'default',
        updatedAt: null,
        updatedBy: null,
      });
    });
  });

  describe('listSelectableCurrencies', () => {
    it('should intersect the supported set with what the registered providers quote', () => {
      expect(buildService().listSelectableCurrencies()).toEqual(['PLN', 'EUR']);
    });

    it('should narrow when a provider is not registered', () => {
      registry.list.mockReturnValue([stubProvider('nbp', ['PLN', 'USD'])]);

      expect(buildService().listSelectableCurrencies()).toEqual(['PLN']);
    });

    it('should be empty when no provider is registered', () => {
      registry.list.mockReturnValue([]);

      expect(buildService().listSelectableCurrencies()).toEqual([]);
    });

    it('should never widen beyond SUPPORTED_REPORTING_CURRENCIES', () => {
      registry.list.mockReturnValue([stubProvider('nbp', ['PLN', 'EUR', 'USD', 'GBP'])]);

      expect(buildService().listSelectableCurrencies()).toEqual(['PLN', 'EUR']);
    });
  });

  describe('setReportingCurrency', () => {
    beforeEach(() => {
      repository.upsertSetting.mockImplementation((code, updatedBy) =>
        Promise.resolve(
          new ReportingCurrencySetting(code, new Date('2026-08-14T06:00:00Z'), updatedBy)
        )
      );
    });

    it('should persist a supported code and flip source to setting', async () => {
      const view = await buildService().setReportingCurrency('PLN', 'user-1');

      expect(repository.upsertSetting).toHaveBeenCalledWith('PLN', 'user-1');
      expect(view).toMatchObject({ reportingCurrency: 'PLN', source: 'setting' });
    });

    it('should normalise the submitted code before validating and persisting', async () => {
      await buildService().setReportingCurrency('  pln ', 'user-1');

      expect(repository.upsertSetting).toHaveBeenCalledWith('PLN', 'user-1');
    });

    it.each(['EU', 'EURO', 'E1R', '', '   ', '123'])(
      'should reject the malformed code %p with InvalidReportingCurrencyError (400)',
      async (code) => {
        await expect(buildService().setReportingCurrency(code, 'user-1')).rejects.toThrow(
          InvalidReportingCurrencyError
        );
        expect(repository.upsertSetting).not.toHaveBeenCalled();
      }
    );

    it('should reject a well-formed but unsupported code with ReportingCurrencyUnsupportedError (422)', async () => {
      await expect(buildService().setReportingCurrency('USD', 'user-1')).rejects.toThrow(
        ReportingCurrencyUnsupportedError
      );
      expect(repository.upsertSetting).not.toHaveBeenCalled();
    });

    it('should carry the accepted set on the 422 error', async () => {
      try {
        await buildService().setReportingCurrency('USD', 'user-1');
        fail('expected setReportingCurrency to throw');
      } catch (error) {
        expect((error as ReportingCurrencyUnsupportedError).supportedCurrencies).toEqual([
          'PLN',
          'EUR',
        ]);
      }
    });

    it('should reject a code whose provider is not registered', async () => {
      // The hard gate is a pure array test, so it holds even with every
      // provider unreachable.
      registry.list.mockReturnValue([stubProvider('nbp', ['PLN', 'USD'])]);

      await expect(buildService().setReportingCurrency('EUR', 'user-1')).rejects.toThrow(
        ReportingCurrencyUnsupportedError
      );
    });

    it('should never block on an unacknowledged coverage gap', async () => {
      // Layer 3 warns and never blocks: blocking on history would let one junk
      // currency in an old snapshot make a legitimate currency unsettable.
      await expect(
        buildService().setReportingCurrency('PLN', 'user-1', { acknowledgeCoverageGaps: false })
      ).resolves.toMatchObject({ reportingCurrency: 'PLN' });
    });

    it('should accept a null actor for a system-driven write', async () => {
      const view = await buildService().setReportingCurrency('PLN', null);

      expect(repository.upsertSetting).toHaveBeenCalledWith('PLN', null);
      expect(view.updatedBy).toBeNull();
    });
  });
});
