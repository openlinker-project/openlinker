/**
 * Analytics Tax Remediation Controller — Unit Tests (#2469)
 *
 * @module apps/api/src/analytics/http
 */
import type { ITaxRateBackfillService, ITaxCoverageDetectionService } from '@openlinker/core/orders';
import type { IReportingCurrencySettingsService } from '@openlinker/core/currency';
import type { IAnalyticsDisplaySettingsService } from '@openlinker/core/analytics';
import { AnalyticsTaxRemediationController } from './analytics-tax-remediation.controller';

describe('AnalyticsTaxRemediationController (#2469)', () => {
  let backfill: jest.Mocked<ITaxRateBackfillService>;
  let taxCoverageDetectionService: jest.Mocked<ITaxCoverageDetectionService>;
  let reportingCurrencySettings: jest.Mocked<IReportingCurrencySettingsService>;
  let displaySettings: jest.Mocked<IAnalyticsDisplaySettingsService>;
  let controller: AnalyticsTaxRemediationController;

  beforeEach(() => {
    backfill = {
      backfillPage: jest.fn(),
      backfillOrders: jest.fn().mockResolvedValue({ scanned: 3, updated: 2 }),
    };
    taxCoverageDetectionService = {
      classify: jest.fn(),
      getCategoryPage: jest.fn(),
      getCategoryCounts: jest.fn(),
      getAllCategoryPages: jest.fn(),
    };
    reportingCurrencySettings = {
      resolve: jest.fn().mockResolvedValue('EUR'),
      getView: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<IReportingCurrencySettingsService>;
    displaySettings = {
      getSettings: jest
        .fn()
        .mockResolvedValue({ includeBackfilledTaxRatesInNetSales: false }),
      updateSettings: jest.fn(),
    } as unknown as jest.Mocked<IAnalyticsDisplaySettingsService>;
    controller = new AnalyticsTaxRemediationController(
      backfill,
      taxCoverageDetectionService,
      reportingCurrencySettings,
      displaySettings
    );
  });

  it('delegates to the SAME resolution the scheduled sweep runs, never a parallel mechanism', async () => {
    const response = await controller.rerunBackfill({
      internalOrderIds: ['ol_order_a', 'ol_order_b'],
    });

    expect(backfill.backfillOrders).toHaveBeenCalledWith(['ol_order_a', 'ol_order_b']);
    expect(backfill.backfillPage).not.toHaveBeenCalled();
    expect(response).toEqual({ scanned: 3, updated: 2 });
  });

  it('collapses duplicate ids so the reported counts match the operator’s selection', async () => {
    await controller.rerunBackfill({
      internalOrderIds: ['ol_order_a', 'ol_order_a', 'ol_order_b'],
    });

    expect(backfill.backfillOrders).toHaveBeenCalledWith(['ol_order_a', 'ol_order_b']);
  });

  it('opens no remediation run and returns synchronously — a backfill attempt is idempotent', async () => {
    // Pinned as a test because the sibling currency action does the opposite,
    // and the Phase 1 decision doc scopes `analytics_remediation_runs` to that
    // category alone. The controller is not even given a ledger service.
    await controller.rerunBackfill({ internalOrderIds: ['ol_order_a'] });

    expect(
      Object.keys(controller as unknown as Record<string, unknown>).some((key) =>
        key.toLowerCase().includes('run')
      )
    ).toBe(false);
  });

  describe('getOrders (#2474)', () => {
    const query = { category: 'tax-a' as const, from: '2026-08-01T00:00:00.000Z', to: '2026-08-27T00:00:00.000Z' };

    it('should resolve the reporting currency and the display setting, then page the classified category', async () => {
      taxCoverageDetectionService.getCategoryPage.mockResolvedValue({
        items: [{ internalOrderId: 'ol_order_a', sourceConnectionId: 'conn-1', placedAt: null }],
        total: 1,
      });

      const response = await controller.getOrders({ ...query, limit: 10, offset: 5 });

      expect(reportingCurrencySettings.resolve).toHaveBeenCalledTimes(1);
      expect(displaySettings.getSettings).toHaveBeenCalledTimes(1);
      expect(taxCoverageDetectionService.getCategoryPage).toHaveBeenCalledWith(
        'tax-a',
        expect.objectContaining({ sourceConnectionId: undefined }),
        'EUR',
        { limit: 10, offset: 5 },
        false
      );
      expect(response.total).toBe(1);
      expect(response.items[0]).toMatchObject({ internalOrderId: 'ol_order_a' });
    });

    it('should default the page size when the caller omits pagination', async () => {
      taxCoverageDetectionService.getCategoryPage.mockResolvedValue({ items: [], total: 0 });

      await controller.getOrders(query);

      expect(taxCoverageDetectionService.getCategoryPage).toHaveBeenCalledWith(
        'tax-a',
        expect.anything(),
        'EUR',
        { limit: 25, offset: 0 },
        false
      );
    });

    it('should thread the operator’s backfilled-pre-rollout opt-in into the classification pass', async () => {
      displaySettings.getSettings.mockResolvedValue({
        includeBackfilledTaxRatesInNetSales: true,
      } as never);
      taxCoverageDetectionService.getCategoryPage.mockResolvedValue({ items: [], total: 0 });

      await controller.getOrders(query);

      expect(taxCoverageDetectionService.getCategoryPage).toHaveBeenCalledWith(
        'tax-a',
        expect.anything(),
        'EUR',
        expect.anything(),
        true
      );
    });
  });
});
