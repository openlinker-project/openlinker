/**
 * Sales Analytics Controller — Unit Tests (#1987, display-currency #2459)
 */
import { BadRequestException } from '@nestjs/common';
import { MIXED_NATIVE_CURRENCIES_LABEL } from '@openlinker/core/orders';
import type {
  CurrentRateConversionResult,
  IDisplayCurrencyConversionService,
  IOrderRecordService,
  OrderDateConversionResult,
  SalesAndChannelAnalytics,
} from '@openlinker/core/orders';
import { SalesAnalyticsController } from './sales-analytics.controller';

describe('SalesAnalyticsController', () => {
  const analytics: SalesAndChannelAnalytics = {
    headline: {
      revenue: 18420.5,
      orderCount: 142,
      averageOrderValue: 129.72,
      medianOrderValue: 98,
      unitsSold: 311,
      unconvertedUnitsSold: 5,
      cancelledCount: 4,
      cancelledValue: 612,
      currency: 'EUR',
      unconvertedCount: 2,
      unconvertedValue: 145,
      unconvertedCurrency: 'PLN',
      netRevenue: 15000,
      netAverageOrderValue: 105.63,
      netMedianOrderValue: 80,
      netExcludedCount: 3,
      netExcludedValue: 300,
      trend: [{ date: '2026-08-01', revenue: 100, orderCount: 1 }],
    },
    channels: [
      {
        sourceConnectionId: 'conn-a',
        revenue: 11980,
        orderCount: 90,
        averageOrderValue: 133.1,
        unitsSold: 200,
        unconvertedUnitsSold: 1,
        cancelledCount: 3,
        cancelledValue: 450,
        currency: 'EUR',
        unconvertedCount: 1,
        unconvertedValue: 60,
        unconvertedCurrency: 'PLN',
        netRevenue: 9000,
        netAverageOrderValue: 105,
        netExcludedCount: 2,
        netExcludedValue: 200,
        revenueShare: 0.65,
        trend: [{ date: '2026-08-01', revenue: 60, orderCount: 1 }],
        coverageComplete: true,
      },
    ],
  };

  const createOrderRecordService = (): jest.Mocked<
    Pick<IOrderRecordService, 'getSalesAndChannelAnalytics'>
  > => ({
    getSalesAndChannelAnalytics: jest.fn(),
  });

  const createDisplayCurrencyConversionService =
    (): jest.Mocked<IDisplayCurrencyConversionService> => ({
      convertAtCurrentRate: jest.fn(),
      convertAtOrderDate: jest.fn(),
    });

  const createController = (
    orderRecordService: jest.Mocked<Pick<IOrderRecordService, 'getSalesAndChannelAnalytics'>>,
    displayCurrencyConversionService: jest.Mocked<IDisplayCurrencyConversionService>
  ): SalesAnalyticsController =>
    new SalesAnalyticsController(
      orderRecordService as unknown as IOrderRecordService,
      displayCurrencyConversionService
    );

  it('maps the query params to filters and projects the domain result into the response DTO', async () => {
    const orderRecordService = createOrderRecordService();
    orderRecordService.getSalesAndChannelAnalytics.mockResolvedValue(analytics);
    const displayCurrencyConversionService = createDisplayCurrencyConversionService();
    const controller = createController(orderRecordService, displayCurrencyConversionService);

    const result = await controller.getSalesAnalytics({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-08T00:00:00.000Z',
      sourceConnectionId: 'conn-a',
    });

    expect(orderRecordService.getSalesAndChannelAnalytics).toHaveBeenCalledWith({
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
      sourceConnectionId: 'conn-a',
    });
    expect(result.headline.revenue).toBe(18420.5);
    expect(result.headline.medianOrderValue).toBe(98);
    expect(result.headline.currency).toBe('EUR');
    expect(result.headline.unconvertedCount).toBe(2);
    expect(result.headline.unconvertedValue).toBe(145);
    expect(result.headline.unconvertedCurrency).toBe('PLN');
    expect(result.headline.unconvertedUnitsSold).toBe(5);
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].sourceConnectionId).toBe('conn-a');
    expect(result.channels[0].coverageComplete).toBe(true);
    expect(result.channels[0].cancelledCount).toBe(3);
    expect(result.channels[0].cancelledValue).toBe(450);
    expect(result.channels[0].currency).toBe('EUR');
    expect(result.channels[0].unconvertedCount).toBe(1);
    expect(result.channels[0].unconvertedCurrency).toBe('PLN');
  });

  it('throws BadRequestException when to <= from', async () => {
    const orderRecordService = createOrderRecordService();
    const controller = createController(
      orderRecordService,
      createDisplayCurrencyConversionService()
    );

    await expect(
      controller.getSalesAnalytics({
        from: '2026-08-08T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      })
    ).rejects.toThrow(BadRequestException);
    expect(orderRecordService.getSalesAndChannelAnalytics).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when to === from', async () => {
    const orderRecordService = createOrderRecordService();
    const controller = createController(
      orderRecordService,
      createDisplayCurrencyConversionService()
    );

    await expect(
      controller.getSalesAnalytics({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when the range exceeds the max window (#1987 review, suggestion 3)', async () => {
    const orderRecordService = createOrderRecordService();
    const controller = createController(
      orderRecordService,
      createDisplayCurrencyConversionService()
    );

    await expect(
      controller.getSalesAnalytics({
        from: '1970-01-01T00:00:00.000Z',
        to: '2100-01-01T00:00:00.000Z',
      })
    ).rejects.toThrow(BadRequestException);
    expect(orderRecordService.getSalesAndChannelAnalytics).not.toHaveBeenCalled();
  });

  describe('display-currency conversion (#2459)', () => {
    it('never calls IDisplayCurrencyConversionService and leaves displayCurrencyConversion unset when displayCurrency is omitted (regression guard)', async () => {
      const orderRecordService = createOrderRecordService();
      orderRecordService.getSalesAndChannelAnalytics.mockResolvedValue(analytics);
      const displayCurrencyConversionService = createDisplayCurrencyConversionService();
      const controller = createController(orderRecordService, displayCurrencyConversionService);

      const result = await controller.getSalesAnalytics({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-08T00:00:00.000Z',
      });

      expect(displayCurrencyConversionService.convertAtCurrentRate).not.toHaveBeenCalled();
      expect(displayCurrencyConversionService.convertAtOrderDate).not.toHaveBeenCalled();
      expect(result.headline.displayCurrencyConversion).toBeUndefined();
      expect(result.channels[0].displayCurrencyConversion).toBeUndefined();
    });

    it("converts headline and channel revenue via convertAtCurrentRate when rateBasis defaults to 'current-rate'", async () => {
      const orderRecordService = createOrderRecordService();
      orderRecordService.getSalesAndChannelAnalytics.mockResolvedValue(analytics);
      const displayCurrencyConversionService = createDisplayCurrencyConversionService();
      const headlineResult: CurrentRateConversionResult = {
        displayCurrency: 'PLN',
        convertedTotal: 82000,
        breakdown: [
          { currency: 'EUR', orderCount: 140, nativeTotal: 18420.5, convertedTotal: 79200 },
          { currency: 'PLN', orderCount: 2, nativeTotal: 145, convertedTotal: null },
        ],
        unresolvedNativeCurrencies: ['XXX'],
      };
      const channelResult: CurrentRateConversionResult = {
        displayCurrency: 'PLN',
        convertedTotal: 52000,
        breakdown: [{ currency: 'EUR', orderCount: 90, nativeTotal: 11980, convertedTotal: 52000 }],
        unresolvedNativeCurrencies: [],
      };
      displayCurrencyConversionService.convertAtCurrentRate
        .mockResolvedValueOnce(headlineResult)
        .mockResolvedValueOnce(channelResult);
      const controller = createController(orderRecordService, displayCurrencyConversionService);

      const result = await controller.getSalesAnalytics({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-08T00:00:00.000Z',
        displayCurrency: 'PLN',
      });

      expect(displayCurrencyConversionService.convertAtOrderDate).not.toHaveBeenCalled();
      // count carries the REAL order count for each bucket (#2488 review,
      // IMPORTANT 1) — headline.orderCount / unconvertedCount, never a flat
      // "1 bucket = 1 order".
      expect(displayCurrencyConversionService.convertAtCurrentRate).toHaveBeenNthCalledWith(1, {
        amounts: [
          { currency: 'EUR', amount: 18420.5, count: 142 },
          { currency: 'PLN', amount: 145, count: 2 },
        ],
        displayCurrency: 'PLN',
      });
      expect(displayCurrencyConversionService.convertAtCurrentRate).toHaveBeenNthCalledWith(2, {
        amounts: [
          { currency: 'EUR', amount: 11980, count: 90 },
          { currency: 'PLN', amount: 60, count: 1 },
        ],
        displayCurrency: 'PLN',
      });
      expect(result.headline.displayCurrencyConversion).toEqual({
        displayCurrency: 'PLN',
        rateBasis: 'current-rate',
        convertedRevenue: 82000,
        unresolvedNativeCurrencies: ['XXX'],
      });
      expect(result.channels[0].displayCurrencyConversion).toEqual({
        displayCurrency: 'PLN',
        rateBasis: 'current-rate',
        convertedRevenue: 52000,
        unresolvedNativeCurrencies: [],
      });
    });

    it("converts headline and channel revenue via convertAtOrderDate when rateBasis is 'order-date', normalising a resolved rate to an empty unresolvedNativeCurrencies list", async () => {
      const orderRecordService = createOrderRecordService();
      orderRecordService.getSalesAndChannelAnalytics.mockResolvedValue(analytics);
      const displayCurrencyConversionService = createDisplayCurrencyConversionService();
      const headlineResult: OrderDateConversionResult = {
        displayCurrency: 'PLN',
        convertedTotal: 79200,
        sourceCurrency: 'EUR',
        unresolved: false,
      };
      const channelResult: OrderDateConversionResult = {
        displayCurrency: 'PLN',
        convertedTotal: 51500,
        sourceCurrency: 'EUR',
        unresolved: false,
      };
      displayCurrencyConversionService.convertAtOrderDate
        .mockResolvedValueOnce(headlineResult)
        .mockResolvedValueOnce(channelResult);
      const controller = createController(orderRecordService, displayCurrencyConversionService);

      const result = await controller.getSalesAnalytics({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-08T00:00:00.000Z',
        displayCurrency: 'PLN',
        rateBasis: 'order-date',
      });

      expect(displayCurrencyConversionService.convertAtCurrentRate).not.toHaveBeenCalled();
      expect(displayCurrencyConversionService.convertAtOrderDate).toHaveBeenNthCalledWith(1, {
        reportingTotal: 18420.5,
        reportingCurrency: 'EUR',
        displayCurrency: 'PLN',
      });
      expect(displayCurrencyConversionService.convertAtOrderDate).toHaveBeenNthCalledWith(2, {
        reportingTotal: 11980,
        reportingCurrency: 'EUR',
        displayCurrency: 'PLN',
      });
      expect(result.headline.displayCurrencyConversion).toEqual({
        displayCurrency: 'PLN',
        rateBasis: 'order-date',
        convertedRevenue: 79200,
        unresolvedNativeCurrencies: [],
      });
      expect(result.channels[0].displayCurrencyConversion).toEqual({
        displayCurrency: 'PLN',
        rateBasis: 'order-date',
        convertedRevenue: 51500,
        unresolvedNativeCurrencies: [],
      });
    });

    it('labels a mixed-currency unconverted bucket with the mixed-currencies sentinel rather than dropping it (#2488 review, IMPORTANT 2)', async () => {
      const mixedAnalytics: SalesAndChannelAnalytics = {
        ...analytics,
        headline: {
          ...analytics.headline,
          unconvertedCount: 3,
          unconvertedValue: 210,
          unconvertedCurrency: null,
        },
      };
      const orderRecordService = createOrderRecordService();
      orderRecordService.getSalesAndChannelAnalytics.mockResolvedValue(mixedAnalytics);
      const displayCurrencyConversionService = createDisplayCurrencyConversionService();
      displayCurrencyConversionService.convertAtCurrentRate.mockResolvedValue({
        displayCurrency: 'PLN',
        convertedTotal: 79200,
        breakdown: [],
        unresolvedNativeCurrencies: [],
      });
      const controller = createController(orderRecordService, displayCurrencyConversionService);

      await controller.getSalesAnalytics({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-08T00:00:00.000Z',
        displayCurrency: 'PLN',
      });

      expect(displayCurrencyConversionService.convertAtCurrentRate).toHaveBeenNthCalledWith(1, {
        amounts: [
          { currency: 'EUR', amount: 18420.5, count: 142 },
          { currency: MIXED_NATIVE_CURRENCIES_LABEL, amount: 210, count: 3 },
        ],
        displayCurrency: 'PLN',
      });
    });

    it('normalises an unresolved convertAtOrderDate outcome into a one-element unresolvedNativeCurrencies list', async () => {
      const orderRecordService = createOrderRecordService();
      orderRecordService.getSalesAndChannelAnalytics.mockResolvedValue(analytics);
      const displayCurrencyConversionService = createDisplayCurrencyConversionService();
      const unresolvedResult: OrderDateConversionResult = {
        displayCurrency: 'PLN',
        convertedTotal: null,
        sourceCurrency: 'EUR',
        unresolved: true,
      };
      displayCurrencyConversionService.convertAtOrderDate.mockResolvedValue(unresolvedResult);
      const controller = createController(orderRecordService, displayCurrencyConversionService);

      const result = await controller.getSalesAnalytics({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-08T00:00:00.000Z',
        displayCurrency: 'PLN',
        rateBasis: 'order-date',
      });

      expect(result.headline.displayCurrencyConversion).toEqual({
        displayCurrency: 'PLN',
        rateBasis: 'order-date',
        convertedRevenue: null,
        unresolvedNativeCurrencies: ['EUR'],
      });
    });
  });
});
