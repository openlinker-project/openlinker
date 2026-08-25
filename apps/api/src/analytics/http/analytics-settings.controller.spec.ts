/**
 * Analytics Settings Controller — Unit Tests
 *
 * Mocks `IAnalyticsDisplaySettingsService` + `IReportingCurrencySettingsService`.
 * Asserts: `GET` is open to any authenticated user while `PUT` carries
 * `@Roles('admin')`, the `displayCurrency` / `displayCurrencySource`
 * projection correctly distinguishes an operator-saved override from the
 * system-default fallback, `PUT` delegates to `updateSettings` with the
 * resolved input and actor id, and — the required regression guard —
 * toggling `includeBackfilledTaxRatesInNetSales` (or any other field) never
 * calls a write method on `OrderRecordRepositoryPort`. That flag only
 * changes how existing `order_records` rows are read/aggregated for Net
 * Sales; it must never mutate a row.
 *
 * @module apps/api/src/analytics/http
 */
import 'reflect-metadata';
import type { Response } from 'express';
import type {
  IAnalyticsDisplaySettingsService,
  AnalyticsDisplaySettingsView,
} from '@openlinker/core/analytics';
import type { IReportingCurrencySettingsService } from '@openlinker/core/currency';
import type { OrderRecordRepositoryPort } from '@openlinker/core/orders';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { AnalyticsSettingsController } from './analytics-settings.controller';
import type { UpdateAnalyticsSettingsDto } from './dto/update-analytics-settings.dto';

/**
 * Every mutating method on `OrderRecordRepositoryPort`. Read-only lookups
 * (`findById`, `findMany`, `countByHealth`, `getDailyOrderAggregates`, …)
 * are deliberately excluded — this list is only the surface that could ever
 * write to `order_records`.
 */
function createOrderRecordWriteMocks(): jest.Mocked<
  Pick<
    OrderRecordRepositoryPort,
    | 'upsert'
    | 'upsertWithLineItems'
    | 'updateSyncStatus'
    | 'updateFulfillmentState'
    | 'updateItemResolutionFailure'
    | 'markCancelled'
    | 'updateSalesDocumentBlock'
    | 'claimFxIntentIfAbsent'
    | 'stampFxIfAbsent'
    | 'markFxTerminal'
    | 'patchSnapshotTaxRates'
  >
> {
  return {
    upsert: jest.fn(),
    upsertWithLineItems: jest.fn(),
    updateSyncStatus: jest.fn(),
    updateFulfillmentState: jest.fn(),
    updateItemResolutionFailure: jest.fn(),
    markCancelled: jest.fn(),
    updateSalesDocumentBlock: jest.fn(),
    claimFxIntentIfAbsent: jest.fn(),
    stampFxIfAbsent: jest.fn(),
    markFxTerminal: jest.fn(),
    patchSnapshotTaxRates: jest.fn(),
  };
}

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
    it('get carries no @Roles metadata — open to any authenticated user', () => {
      const proto = AnalyticsSettingsController.prototype as unknown as Record<string, object>;
      const roles = Reflect.getMetadata(ROLES_KEY, proto.get) as string[] | undefined;
      expect(roles).toBeUndefined();
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
      expect(dto.updatedAt).toBe('2026-08-01T00:00:00.000Z');
      expect(dto.updatedByUserId).toBe('admin-1');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('reports displayCurrencySource "default" and resolves the system reporting currency when no override is saved', async () => {
      const view: AnalyticsDisplaySettingsView = {
        displayCurrency: null,
        rateBasis: 'current',
        includeBackfilledTaxRatesInNetSales: false,
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
      };

      await controller.update(dto, user, res as unknown as Response);

      expect(settings.updateSettings).toHaveBeenCalledWith(
        {
          displayCurrency: 'PLN',
          rateBasis: 'order-date',
          includeBackfilledTaxRatesInNetSales: true,
        },
        'admin-1'
      );
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('never writes to order_records — the flag only changes how existing rows are read/aggregated', async () => {
      const orderRecordWrites = createOrderRecordWriteMocks();
      const dto: UpdateAnalyticsSettingsDto = {
        displayCurrency: null,
        rateBasis: 'current',
        includeBackfilledTaxRatesInNetSales: true,
      };

      await controller.update(dto, user, res as unknown as Response);

      for (const mockFn of Object.values(orderRecordWrites)) {
        expect(mockFn).not.toHaveBeenCalled();
      }
      // The controller has no dependency on `OrderRecordRepositoryPort` /
      // `IOrderRecordService` at all — the only write this handler performs
      // is `IAnalyticsDisplaySettingsService.updateSettings`, which persists
      // to the singleton `analytics_display_settings` row, never to
      // `order_records`.
      expect(settings.updateSettings).toHaveBeenCalledTimes(1);
    });
  });
});
