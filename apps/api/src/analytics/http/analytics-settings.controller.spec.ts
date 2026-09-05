/**
 * Analytics Settings Controller — Unit Tests
 *
 * Mocks `IAnalyticsDisplaySettingsService` + `IReportingCurrencySettingsService`.
 * Asserts: `GET` is open to any authenticated user while `PUT` carries
 * `@Roles('admin')`, the `displayCurrency` / `displayCurrencySource`
 * projection correctly distinguishes an operator-saved override from the
 * system-default fallback, `PUT` delegates to `updateSettings` with the
 * resolved input and actor id, and — the required regression guard — the
 * controller's own source carries no reference to `order_records` write
 * surfaces (`OrderRecordRepositoryPort` / `IOrderRecordService` / their DI
 * tokens). Toggling `includeBackfilledTaxRatesInNetSales` (or any other
 * field) only changes how existing `order_records` rows are read/aggregated
 * for Net Sales; it must never mutate a row. The guard is a static
 * source-inspection check rather than a mock-call assertion — the
 * controller's constructor takes only `IAnalyticsDisplaySettingsService` and
 * `IReportingCurrencySettingsService`, so a mocked `OrderRecordRepositoryPort`
 * would never be reachable from the code under test and the assertion "it
 * was never called" would be true no matter what the controller did.
 *
 * @module apps/api/src/analytics/http
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import type {
  IAnalyticsDisplaySettingsService,
  AnalyticsDisplaySettingsView,
} from '@openlinker/core/analytics';
import type { IReportingCurrencySettingsService } from '@openlinker/core/currency';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { AnalyticsSettingsController } from './analytics-settings.controller';
import type { UpdateAnalyticsSettingsDto } from './dto/update-analytics-settings.dto';

/**
 * Symbols that would only appear in this file if the controller (directly or
 * via a re-exported barrel type) reached for an `order_records` write
 * surface. None of them is legitimate here: the controller's only
 * dependencies are the two settings-service interfaces injected in its
 * constructor.
 */
const FORBIDDEN_ORDER_RECORD_REFERENCES = [
  'OrderRecordRepositoryPort',
  'IOrderRecordService',
  'ORDER_RECORD_REPOSITORY_TOKEN',
  'ORDER_RECORD_SERVICE_TOKEN',
  '@openlinker/core/orders',
] as const;

describe('AnalyticsSettingsController', () => {
  let settings: jest.Mocked<IAnalyticsDisplaySettingsService>;
  let reportingCurrency: jest.Mocked<IReportingCurrencySettingsService>;
  let controller: AnalyticsSettingsController;
  let res: jest.Mocked<Pick<Response, 'setHeader'>>;
  const user = { id: 'admin-1' } as AuthenticatedUser;

  beforeEach(() => {
    settings = {
      getSettings: jest.fn(),
      updateSettings: jest.fn(),
    };
    reportingCurrency = {
      resolve: jest.fn(),
      getView: jest.fn(),
      setReportingCurrency: jest.fn(),
      listSelectableCurrencies: jest.fn(),
    };
    res = { setHeader: jest.fn() };
    controller = new AnalyticsSettingsController(settings, reportingCurrency);
  });

  describe('role gating', () => {
    it('get carries @Roles(admin, operator, viewer) — excludes packer from commercial analytics (#2413)', () => {
      const proto = AnalyticsSettingsController.prototype as unknown as Record<string, object>;
      const roles = Reflect.getMetadata(ROLES_KEY, proto.get) as string[] | undefined;
      expect(roles).toEqual(['admin', 'operator', 'viewer']);
    });

    it('update carries @Roles(admin)', () => {
      const proto = AnalyticsSettingsController.prototype as unknown as Record<string, object>;
      const roles = Reflect.getMetadata(ROLES_KEY, proto.update) as string[] | undefined;
      expect(roles).toEqual(['admin']);
    });
  });

  describe('get', () => {
    it('reports displayCurrencySource "setting" and echoes the saved override when one exists', async () => {
      const view: AnalyticsDisplaySettingsView = {
        displayCurrency: 'PLN',
        rateBasis: 'order-date',
        includeBackfilledTaxRatesInNetSales: true,
        netGrossBasis: 'net',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        updatedByUserId: 'admin-1',
      };
      settings.getSettings.mockResolvedValue(view);
      reportingCurrency.resolve.mockResolvedValue('EUR');

      const dto = await controller.get(res as unknown as Response);

      expect(dto.displayCurrency).toBe('PLN');
      expect(dto.displayCurrencySource).toBe('setting');
      expect(dto.rateBasis).toBe('order-date');
      expect(dto.includeBackfilledTaxRatesInNetSales).toBe(true);
      expect(dto.netGrossBasis).toBe('net');
      expect(dto.updatedAt).toBe('2026-08-01T00:00:00.000Z');
      expect(dto.updatedByUserId).toBe('admin-1');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('reports displayCurrencySource "default" and resolves the system reporting currency when no override is saved', async () => {
      const view: AnalyticsDisplaySettingsView = {
        displayCurrency: null,
        rateBasis: 'current',
        includeBackfilledTaxRatesInNetSales: false,
        netGrossBasis: 'gross',
        updatedAt: null,
        updatedByUserId: null,
      };
      settings.getSettings.mockResolvedValue(view);
      reportingCurrency.resolve.mockResolvedValue('EUR');

      const dto = await controller.get(res as unknown as Response);

      expect(dto.displayCurrency).toBe('EUR');
      expect(dto.displayCurrencySource).toBe('default');
      expect(dto.updatedAt).toBeNull();
      expect(dto.updatedByUserId).toBeNull();
    });
  });

  describe('update', () => {
    it('delegates to updateSettings with the DTO fields and the actor id', async () => {
      const dto: UpdateAnalyticsSettingsDto = {
        displayCurrency: 'PLN',
        rateBasis: 'order-date',
        includeBackfilledTaxRatesInNetSales: true,
        netGrossBasis: 'net',
      };

      await controller.update(dto, user, res as unknown as Response);

      expect(settings.updateSettings).toHaveBeenCalledWith(
        {
          displayCurrency: 'PLN',
          rateBasis: 'order-date',
          includeBackfilledTaxRatesInNetSales: true,
          netGrossBasis: 'net',
        },
        'admin-1'
      );
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('never writes to order_records — the controller has no reachable dependency on an order_records write surface', () => {
      // A mock-call assertion can't express this: the controller's
      // constructor only takes `IAnalyticsDisplaySettingsService` and
      // `IReportingCurrencySettingsService`, so an `OrderRecordRepositoryPort`
      // mock would never be wired into the code under test regardless of
      // what the controller does. Instead, assert directly against the
      // controller's own source that it never references an order_records
      // write surface at all — the only write this handler performs is
      // `IAnalyticsDisplaySettingsService.updateSettings`, which persists to
      // the singleton `analytics_display_settings` row.
      const source = readFileSync(join(__dirname, 'analytics-settings.controller.ts'), 'utf8');

      for (const forbidden of FORBIDDEN_ORDER_RECORD_REFERENCES) {
        expect(source).not.toContain(forbidden);
      }
    });
  });
});
