/**
 * Analytics Coverage Controller — Unit Tests (#2466)
 *
 * @module apps/api/src/analytics/http
 */
import { BadRequestException } from '@nestjs/common';
import type {
  IOrderRecordService,
  ITaxCoverageDetectionService,
  PaginatedCurrencyMismatchOrders,
  PaginatedProductMatchingErrorOrders,
  PaginatedTaxCoverageOrders,
  TaxCoverageCategory,
} from '@openlinker/core/orders';
import type { IReportingCurrencySettingsService } from '@openlinker/core/currency';
import type { IAnalyticsDisplaySettingsService, IAnalyticsRemediationRunService } from '@openlinker/core/analytics';
import { AnalyticsCoverageController } from './analytics-coverage.controller';
import type { AnalyticsCoverageQueryDto } from './dto/analytics-coverage-query.dto';

describe('AnalyticsCoverageController (#2466)', () => {
  const createOrderRecordService = (): jest.Mocked<
    Pick<
      IOrderRecordService,
      | 'getCurrencyMismatchOrders'
      | 'getCurrencyMismatchOrdersByConnection'
      | 'getProductMatchingErrorOrders'
    >
  > => ({
    getCurrencyMismatchOrders: jest.fn(),
    getCurrencyMismatchOrdersByConnection: jest.fn(),
    getProductMatchingErrorOrders: jest.fn(),
  });

  const createTaxCoverageDetectionService = (): jest.Mocked<
    Pick<ITaxCoverageDetectionService, 'getAllCategoryPages' | 'getAllCategoryCountsByConnection'>
  > => ({
    getAllCategoryPages: jest.fn(),
    getAllCategoryCountsByConnection: jest.fn(),
  });

  const createReportingCurrencySettings = (): jest.Mocked<
    Pick<IReportingCurrencySettingsService, 'resolve'>
  > => ({
    resolve: jest.fn(),
  });

  const createDisplaySettings = (
    includeBackfilledTaxRatesInNetSales = false
  ): jest.Mocked<Pick<IAnalyticsDisplaySettingsService, 'getSettings'>> => ({
    getSettings: jest.fn().mockResolvedValue({
      displayCurrency: null,
      rateBasis: 'current',
      includeBackfilledTaxRatesInNetSales,
      updatedAt: null,
      updatedByUserId: null,
    }),
  });

  const createRemediationRuns = (): jest.Mocked<Pick<IAnalyticsRemediationRunService, 'getOpenRun'>> => ({
    getOpenRun: jest.fn().mockResolvedValue(null),
  });

  const emptyPage = { items: [], total: 0 };

  const emptyTaxPages = (): Record<TaxCoverageCategory, PaginatedTaxCoverageOrders> => ({
    'tax-a': { items: [], total: 0 },
    'tax-b': { items: [], total: 0 },
    'tax-c': { items: [], total: 0 },
  });

  function buildController(
    orderRecordService = createOrderRecordService(),
    taxCoverageDetectionService = createTaxCoverageDetectionService(),
    reportingCurrencySettings = createReportingCurrencySettings(),
    displaySettings = createDisplaySettings(),
    remediationRuns = createRemediationRuns()
  ): {
    controller: AnalyticsCoverageController;
    orderRecordService: ReturnType<typeof createOrderRecordService>;
    taxCoverageDetectionService: ReturnType<typeof createTaxCoverageDetectionService>;
    reportingCurrencySettings: ReturnType<typeof createReportingCurrencySettings>;
    displaySettings: ReturnType<typeof createDisplaySettings>;
    remediationRuns: ReturnType<typeof createRemediationRuns>;
  } {
    const controller = new AnalyticsCoverageController(
      orderRecordService as unknown as IOrderRecordService,
      taxCoverageDetectionService as unknown as ITaxCoverageDetectionService,
      reportingCurrencySettings as unknown as IReportingCurrencySettingsService,
      displaySettings as unknown as IAnalyticsDisplaySettingsService,
      remediationRuns as unknown as IAnalyticsRemediationRunService
    );
    return {
      controller,
      orderRecordService,
      taxCoverageDetectionService,
      reportingCurrencySettings,
      displaySettings,
      remediationRuns,
    };
  }

  const query: AnalyticsCoverageQueryDto = {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-08T00:00:00.000Z',
  };

  it('reports all-clear (every category affectedCount: 0) when every detector is empty', async () => {
    const { controller, orderRecordService, taxCoverageDetectionService, reportingCurrencySettings } =
      buildController();
    reportingCurrencySettings.resolve.mockResolvedValue('EUR');
    orderRecordService.getCurrencyMismatchOrders.mockResolvedValue(
      emptyPage as PaginatedCurrencyMismatchOrders
    );
    orderRecordService.getProductMatchingErrorOrders.mockResolvedValue(
      emptyPage as PaginatedProductMatchingErrorOrders
    );
    taxCoverageDetectionService.getAllCategoryPages.mockResolvedValue(emptyTaxPages());

    const result = await controller.getCoverage(query);

    expect(result.categories).toHaveLength(5);
    expect(result.categories.map((c) => c.category).sort()).toEqual(
      ['currency', 'product-matching', 'tax-a', 'tax-b', 'tax-c'].sort()
    );
    for (const row of result.categories) {
      expect(row.affectedCount).toBe(0);
      expect(row.sampleOrderIds).toEqual([]);
      expect(row.status).toBe('open');
    }
  });

  it('resolves the current reporting currency ONCE and threads it into both currency and tax reads', async () => {
    const { controller, orderRecordService, taxCoverageDetectionService, reportingCurrencySettings } =
      buildController();
    reportingCurrencySettings.resolve.mockResolvedValue('PLN');
    orderRecordService.getCurrencyMismatchOrders.mockResolvedValue(
      emptyPage as PaginatedCurrencyMismatchOrders
    );
    orderRecordService.getProductMatchingErrorOrders.mockResolvedValue(
      emptyPage as PaginatedProductMatchingErrorOrders
    );
    taxCoverageDetectionService.getAllCategoryPages.mockResolvedValue(emptyTaxPages());

    await controller.getCoverage(query);

    expect(reportingCurrencySettings.resolve).toHaveBeenCalledTimes(1);
    expect(orderRecordService.getCurrencyMismatchOrders).toHaveBeenCalledWith(
      expect.anything(),
      'PLN',
      expect.anything()
    );
    expect(taxCoverageDetectionService.getAllCategoryPages).toHaveBeenCalledWith(
      expect.anything(),
      'PLN',
      expect.anything(),
      expect.anything()
    );
  });

  it("threads the operator's backfilled-tax-rate opt-in through, read fresh per request (#2469)", async () => {
    const displaySettings = createDisplaySettings(true);
    const {
      controller,
      orderRecordService,
      taxCoverageDetectionService,
      reportingCurrencySettings,
    } = buildController(undefined, undefined, undefined, displaySettings);
    reportingCurrencySettings.resolve.mockResolvedValue('EUR');
    orderRecordService.getCurrencyMismatchOrders.mockResolvedValue(
      emptyPage as PaginatedCurrencyMismatchOrders
    );
    orderRecordService.getProductMatchingErrorOrders.mockResolvedValue(
      emptyPage as PaginatedProductMatchingErrorOrders
    );
    taxCoverageDetectionService.getAllCategoryPages.mockResolvedValue(emptyTaxPages());

    await controller.getCoverage(query);

    expect(displaySettings.getSettings).toHaveBeenCalledTimes(1);
    expect(taxCoverageDetectionService.getAllCategoryPages).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true
    );
  });

  it('maps affectedCount + sampleOrderIds from each detector, including all three tax sub-categories', async () => {
    const { controller, orderRecordService, taxCoverageDetectionService, reportingCurrencySettings } =
      buildController();
    reportingCurrencySettings.resolve.mockResolvedValue('EUR');
    orderRecordService.getCurrencyMismatchOrders.mockResolvedValue({
      items: [
        {
          internalOrderId: 'order-currency-1',
          sourceConnectionId: 'conn-a',
          nativeCurrency: 'PLN',
          stampedCurrency: null,
          stampedAt: null,
          lineProducts: [],
        },
      ],
      total: 4,
    });
    orderRecordService.getProductMatchingErrorOrders.mockResolvedValue({
      items: [
        {
          internalOrderId: 'order-mapping-1',
          sourceConnectionId: 'conn-a',
          recordStatus: 'awaiting_mapping',
          mappingFailureReason: 'no variant mapping',
          createdAt: new Date('2026-08-02T00:00:00Z'),
          productId: null,
          variantId: null,
        },
      ],
      total: 7,
    });
    taxCoverageDetectionService.getAllCategoryPages.mockResolvedValue({
      'tax-a': {
        items: [{ internalOrderId: 'order-tax-a-1', sourceConnectionId: 'conn-a', placedAt: null, lineRates: [] }],
        total: 1,
      },
      'tax-b': { items: [], total: 0 },
      'tax-c': {
        items: [{ internalOrderId: 'order-tax-c-1', sourceConnectionId: 'conn-a', placedAt: null, lineRates: [] }],
        total: 2,
      },
    });

    const result = await controller.getCoverage(query);

    const byCategory = new Map(result.categories.map((row) => [row.category, row]));
    expect(byCategory.get('currency')).toMatchObject({
      affectedCount: 4,
      sampleOrderIds: ['order-currency-1'],
    });
    expect(byCategory.get('product-matching')).toMatchObject({
      affectedCount: 7,
      sampleOrderIds: ['order-mapping-1'],
    });
    expect(byCategory.get('tax-a')).toMatchObject({
      affectedCount: 1,
      sampleOrderIds: ['order-tax-a-1'],
    });
    expect(byCategory.get('tax-b')).toMatchObject({ affectedCount: 0, sampleOrderIds: [] });
    expect(byCategory.get('tax-c')).toMatchObject({
      affectedCount: 2,
      sampleOrderIds: ['order-tax-c-1'],
    });
  });

  it('reports the currency row as in-progress with its activeRunId when a run is open (#2475)', async () => {
    const { controller, orderRecordService, taxCoverageDetectionService, reportingCurrencySettings, remediationRuns } =
      buildController();
    reportingCurrencySettings.resolve.mockResolvedValue('EUR');
    orderRecordService.getCurrencyMismatchOrders.mockResolvedValue(
      emptyPage as PaginatedCurrencyMismatchOrders
    );
    orderRecordService.getProductMatchingErrorOrders.mockResolvedValue(
      emptyPage as PaginatedProductMatchingErrorOrders
    );
    taxCoverageDetectionService.getAllCategoryPages.mockResolvedValue(emptyTaxPages());
    remediationRuns.getOpenRun.mockResolvedValue({
      id: 'ol_remrun_reload',
      category: 'currency',
      status: 'in-progress',
      detail: null,
      affectedCount: 5,
      triggeredByUserId: 'user-1',
      createdAt: new Date('2026-08-26T09:00:00Z'),
      updatedAt: new Date('2026-08-26T09:00:00Z'),
    });

    const result = await controller.getCoverage(query);

    expect(remediationRuns.getOpenRun).toHaveBeenCalledWith('currency');
    const currencyRow = result.categories.find((row) => row.category === 'currency');
    expect(currencyRow).toMatchObject({ status: 'in-progress', activeRunId: 'ol_remrun_reload' });
    // Every other category is unaffected by a currency-only run.
    for (const row of result.categories) {
      if (row.category === 'currency') continue;
      expect(row.status).toBe('open');
      expect(row.activeRunId).toBeUndefined();
    }
  });

  it('throws BadRequestException when to is not after from', async () => {
    const { controller } = buildController();

    await expect(
      controller.getCoverage({ from: '2026-08-08T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' })
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when the range exceeds the max window', async () => {
    const { controller } = buildController();

    await expect(
      controller.getCoverage({ from: '2020-01-01T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z' })
    ).rejects.toThrow(BadRequestException);
  });

  describe('getCoverageByConnection (#2713)', () => {
    it('composes the currency + tax A/B/C aggregates into one { category, rows } list, excluding product-matching', async () => {
      const { controller, orderRecordService, taxCoverageDetectionService, reportingCurrencySettings } =
        buildController();
      reportingCurrencySettings.resolve.mockResolvedValue('EUR');
      orderRecordService.getCurrencyMismatchOrdersByConnection.mockResolvedValue([
        { sourceConnectionId: 'conn-a', affectedCount: 3 },
        { sourceConnectionId: 'conn-b', affectedCount: 1 },
      ]);
      taxCoverageDetectionService.getAllCategoryCountsByConnection.mockResolvedValue({
        'tax-a': [{ sourceConnectionId: 'conn-a', affectedCount: 2 }],
        'tax-b': [],
        'tax-c': [{ sourceConnectionId: 'conn-b', affectedCount: 5 }],
      });

      const result = await controller.getCoverageByConnection(query);

      expect(result.categories.map((row) => row.category).sort()).toEqual(
        ['currency', 'tax-a', 'tax-b', 'tax-c'].sort()
      );
      const byCategory = new Map(result.categories.map((row) => [row.category, row.rows]));
      expect(byCategory.get('currency')).toEqual([
        { sourceConnectionId: 'conn-a', affectedCount: 3 },
        { sourceConnectionId: 'conn-b', affectedCount: 1 },
      ]);
      expect(byCategory.get('tax-a')).toEqual([{ sourceConnectionId: 'conn-a', affectedCount: 2 }]);
      expect(byCategory.get('tax-b')).toEqual([]);
      expect(byCategory.get('tax-c')).toEqual([{ sourceConnectionId: 'conn-b', affectedCount: 5 }]);
    });

    it('resolves the current reporting currency ONCE and threads it into both reads', async () => {
      const { controller, orderRecordService, taxCoverageDetectionService, reportingCurrencySettings } =
        buildController();
      reportingCurrencySettings.resolve.mockResolvedValue('PLN');
      orderRecordService.getCurrencyMismatchOrdersByConnection.mockResolvedValue([]);
      taxCoverageDetectionService.getAllCategoryCountsByConnection.mockResolvedValue({
        'tax-a': [],
        'tax-b': [],
        'tax-c': [],
      });

      await controller.getCoverageByConnection(query);

      expect(reportingCurrencySettings.resolve).toHaveBeenCalledTimes(1);
      expect(orderRecordService.getCurrencyMismatchOrdersByConnection).toHaveBeenCalledWith(
        expect.anything(),
        'PLN'
      );
      expect(taxCoverageDetectionService.getAllCategoryCountsByConnection).toHaveBeenCalledWith(
        expect.anything(),
        'PLN',
        expect.anything()
      );
    });

    it("threads the operator's backfilled-tax-rate opt-in through (#2469)", async () => {
      const displaySettings = createDisplaySettings(true);
      const { controller, orderRecordService, taxCoverageDetectionService, reportingCurrencySettings } =
        buildController(undefined, undefined, undefined, displaySettings);
      reportingCurrencySettings.resolve.mockResolvedValue('EUR');
      orderRecordService.getCurrencyMismatchOrdersByConnection.mockResolvedValue([]);
      taxCoverageDetectionService.getAllCategoryCountsByConnection.mockResolvedValue({
        'tax-a': [],
        'tax-b': [],
        'tax-c': [],
      });

      await controller.getCoverageByConnection(query);

      expect(taxCoverageDetectionService.getAllCategoryCountsByConnection).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        true
      );
    });

    it('narrows both underlying reads when sourceConnectionId is provided', async () => {
      const { controller, orderRecordService, taxCoverageDetectionService, reportingCurrencySettings } =
        buildController();
      reportingCurrencySettings.resolve.mockResolvedValue('EUR');
      orderRecordService.getCurrencyMismatchOrdersByConnection.mockResolvedValue([]);
      taxCoverageDetectionService.getAllCategoryCountsByConnection.mockResolvedValue({
        'tax-a': [],
        'tax-b': [],
        'tax-c': [],
      });

      await controller.getCoverageByConnection({ ...query, sourceConnectionId: 'conn-a' });

      expect(orderRecordService.getCurrencyMismatchOrdersByConnection).toHaveBeenCalledWith(
        expect.objectContaining({ sourceConnectionId: 'conn-a' }),
        'EUR'
      );
      expect(taxCoverageDetectionService.getAllCategoryCountsByConnection).toHaveBeenCalledWith(
        expect.objectContaining({ sourceConnectionId: 'conn-a' }),
        'EUR',
        expect.anything()
      );
    });

    it('throws BadRequestException when to is not after from', async () => {
      const { controller } = buildController();

      await expect(
        controller.getCoverageByConnection({
          from: '2026-08-08T00:00:00.000Z',
          to: '2026-08-01T00:00:00.000Z',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the range exceeds the max window', async () => {
      const { controller } = buildController();

      await expect(
        controller.getCoverageByConnection({
          from: '2020-01-01T00:00:00.000Z',
          to: '2026-08-08T00:00:00.000Z',
        })
      ).rejects.toThrow(BadRequestException);
    });
  });
});
