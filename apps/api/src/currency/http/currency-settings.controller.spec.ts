/**
 * Currency Settings Controller — Unit Tests
 *
 * Focused on the domain-exception -> HTTP-status mapping `withDomainExceptionMapping`
 * performs (400 / 422), and on the response carrying `source`, `supportedCurrencies`,
 * the per-candidate coverage set and the stamped-row counts (#2126). The two upstream
 * services are mocked at the port boundary.
 *
 * @module apps/api/src/currency/http
 */
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type {
  ExchangeRateProviderPort,
  ExchangeRateProviderRegistryPort,
  IReportingCurrencySettingsService,
  ReportingCurrencySettingsView,
} from '@openlinker/core/currency';
import {
  EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN,
  InvalidReportingCurrencyError,
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  ReportingCurrencyUnsupportedError,
} from '@openlinker/core/currency';
import type { IOrderFxReadService } from '@openlinker/core/orders';
import { ORDER_FX_READ_SERVICE_TOKEN } from '@openlinker/core/orders';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { CurrencySettingsController } from './currency-settings.controller';

const adminUser: AuthenticatedUser = { id: 'u1', username: 'admin', role: 'admin' };

function fakeResponse(): { setHeader: jest.Mock } {
  return { setHeader: jest.fn() };
}

function makeView(overrides: Partial<ReportingCurrencySettingsView> = {}): ReportingCurrencySettingsView {
  return {
    reportingCurrency: overrides.reportingCurrency ?? 'EUR',
    source: overrides.source ?? 'default',
    updatedAt: overrides.updatedAt ?? null,
    updatedBy: overrides.updatedBy ?? null,
    supportedCurrencies: overrides.supportedCurrencies ?? ['PLN', 'EUR'],
  };
}

function makeProvider(overrides: Partial<ExchangeRateProviderPort> = {}): ExchangeRateProviderPort {
  return {
    name: overrides.name ?? 'nbp',
    pivotCurrency: overrides.pivotCurrency ?? 'PLN',
    supports: overrides.supports ?? jest.fn().mockReturnValue(true),
    listSupportedCurrencies: overrides.listSupportedCurrencies ?? jest.fn().mockReturnValue(['EUR', 'PLN']),
    fetchRate: overrides.fetchRate ?? jest.fn(),
  };
}

describe('CurrencySettingsController', () => {
  let controller: CurrencySettingsController;
  let settings: jest.Mocked<IReportingCurrencySettingsService>;
  let providers: jest.Mocked<ExchangeRateProviderRegistryPort>;
  let orderFxReads: jest.Mocked<IOrderFxReadService>;

  beforeEach(async () => {
    settings = {
      resolve: jest.fn(),
      getView: jest.fn(),
      setReportingCurrency: jest.fn(),
      listSelectableCurrencies: jest.fn(),
    } as unknown as jest.Mocked<IReportingCurrencySettingsService>;

    providers = {
      register: jest.fn(),
      get: jest.fn(),
      has: jest.fn(),
      list: jest.fn(),
    } as unknown as jest.Mocked<ExchangeRateProviderRegistryPort>;

    orderFxReads = {
      listDistinctNativeCurrencies: jest.fn(),
      countStampedByReportingCurrency: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CurrencySettingsController],
      providers: [
        { provide: REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN, useValue: settings },
        { provide: EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN, useValue: providers },
        { provide: ORDER_FX_READ_SERVICE_TOKEN, useValue: orderFxReads },
      ],
    }).compile();

    controller = module.get(CurrencySettingsController);
  });

  describe('GET /currency-settings', () => {
    it('should carry the resolved value, its source, the selectable set and the stamped counts', async () => {
      settings.getView.mockResolvedValue(makeView({ reportingCurrency: 'PLN', source: 'setting' }));
      orderFxReads.listDistinctNativeCurrencies.mockResolvedValue(['EUR', 'USD']);
      orderFxReads.countStampedByReportingCurrency.mockResolvedValue([
        { reportingCurrency: 'PLN', count: 3947 },
        { reportingCurrency: 'EUR', count: 1284 },
      ]);
      providers.has.mockReturnValue(true);
      providers.get.mockReturnValue(makeProvider());

      const result = await controller.get(fakeResponse() as never);

      expect(result.reportingCurrency).toBe('PLN');
      expect(result.source).toBe('setting');
      expect(result.supportedCurrencies).toEqual(['PLN', 'EUR']);
      expect(result.stampedOrders).toEqual([
        { reportingCurrency: 'PLN', count: 3947 },
        { reportingCurrency: 'EUR', count: 1284 },
      ]);
    });

    it('should carry one coverage entry per supported candidate', async () => {
      settings.getView.mockResolvedValue(makeView({ supportedCurrencies: ['PLN', 'EUR'] }));
      orderFxReads.listDistinctNativeCurrencies.mockResolvedValue(['USD']);
      orderFxReads.countStampedByReportingCurrency.mockResolvedValue([]);
      providers.has.mockReturnValue(true);
      providers.get.mockImplementation((source) =>
        makeProvider({ name: source, supports: jest.fn().mockReturnValue(source === 'nbp') })
      );

      const result = await controller.get(fakeResponse() as never);

      expect(result.coverage).toHaveLength(2);
      const plnCoverage = result.coverage.find((c) => c.reportingCurrency === 'PLN');
      expect(plnCoverage?.uncoverableCurrencies).toEqual([]);
      const eurCoverage = result.coverage.find((c) => c.reportingCurrency === 'EUR');
      expect(eurCoverage?.uncoverableCurrencies).toEqual(['USD']);
    });

    it('should report rateSource null and an empty advisory when no provider is registered for a candidate', async () => {
      settings.getView.mockResolvedValue(makeView({ supportedCurrencies: ['PLN'] }));
      orderFxReads.listDistinctNativeCurrencies.mockResolvedValue(['USD']);
      orderFxReads.countStampedByReportingCurrency.mockResolvedValue([]);
      providers.has.mockReturnValue(false);

      const result = await controller.get(fakeResponse() as never);

      expect(result.coverage[0].rateSource).toBeNull();
      expect(result.coverage[0].uncoverableCurrencies).toEqual([]);
      expect(result.coverage[0].observedCurrencies).toEqual(['USD']);
    });

    it('should set Cache-Control: no-store', async () => {
      settings.getView.mockResolvedValue(makeView());
      orderFxReads.listDistinctNativeCurrencies.mockResolvedValue([]);
      orderFxReads.countStampedByReportingCurrency.mockResolvedValue([]);
      providers.has.mockReturnValue(false);
      const res = fakeResponse();

      await controller.get(res as never);

      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });

  describe('PUT /currency-settings/reporting-currency', () => {
    it('should save on the happy path and thread acknowledgeCoverageGaps through', async () => {
      settings.setReportingCurrency.mockResolvedValue(makeView({ reportingCurrency: 'PLN' }));

      await controller.setReportingCurrency(
        { reportingCurrency: 'PLN', acknowledgeCoverageGaps: true },
        adminUser,
        fakeResponse() as never
      );

      expect(settings.setReportingCurrency).toHaveBeenCalledWith('PLN', 'u1', {
        acknowledgeCoverageGaps: true,
      });
    });

    it('should default acknowledgeCoverageGaps to false when omitted', async () => {
      settings.setReportingCurrency.mockResolvedValue(makeView());

      await controller.setReportingCurrency(
        { reportingCurrency: 'PLN' },
        adminUser,
        fakeResponse() as never
      );

      expect(settings.setReportingCurrency).toHaveBeenCalledWith('PLN', 'u1', {
        acknowledgeCoverageGaps: false,
      });
    });

    it('should map InvalidReportingCurrencyError to 400', async () => {
      settings.setReportingCurrency.mockRejectedValue(new InvalidReportingCurrencyError('pl'));

      await expect(
        controller.setReportingCurrency({ reportingCurrency: 'pl' }, adminUser, fakeResponse() as never)
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should map ReportingCurrencyUnsupportedError to 422', async () => {
      settings.setReportingCurrency.mockRejectedValue(
        new ReportingCurrencyUnsupportedError('TRY', ['PLN', 'EUR'])
      );

      await expect(
        controller.setReportingCurrency({ reportingCurrency: 'TRY' }, adminUser, fakeResponse() as never)
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('should let an unrelated error propagate unmapped', async () => {
      settings.setReportingCurrency.mockRejectedValue(new Error('db unreachable'));

      await expect(
        controller.setReportingCurrency({ reportingCurrency: 'PLN' }, adminUser, fakeResponse() as never)
      ).rejects.toThrow('db unreachable');
    });
  });
});
