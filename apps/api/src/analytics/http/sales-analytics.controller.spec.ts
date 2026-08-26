/**
 * Sales Analytics Controller — Unit Tests (#1987)
 */
import { BadRequestException } from '@nestjs/common';
import type { IOrderRecordService, SalesAndChannelAnalytics } from '@openlinker/core/orders';
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

  const createService = (): jest.Mocked<Pick<IOrderRecordService, 'getSalesAndChannelAnalytics'>> => ({
    getSalesAndChannelAnalytics: jest.fn(),
  });

  it('maps the query params to filters and projects the domain result into the response DTO', async () => {
    const service = createService();
    service.getSalesAndChannelAnalytics.mockResolvedValue(analytics);
    const controller = new SalesAnalyticsController(service as unknown as IOrderRecordService);

    const result = await controller.getSalesAnalytics({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-08T00:00:00.000Z',
      sourceConnectionId: 'conn-a',
    });

    expect(service.getSalesAndChannelAnalytics).toHaveBeenCalledWith({
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
    const service = createService();
    const controller = new SalesAnalyticsController(service as unknown as IOrderRecordService);

    await expect(
      controller.getSalesAnalytics({
        from: '2026-08-08T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      })
    ).rejects.toThrow(BadRequestException);
    expect(service.getSalesAndChannelAnalytics).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when to === from', async () => {
    const service = createService();
    const controller = new SalesAnalyticsController(service as unknown as IOrderRecordService);

    await expect(
      controller.getSalesAnalytics({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when the range exceeds the max window (#1987 review, suggestion 3)', async () => {
    const service = createService();
    const controller = new SalesAnalyticsController(service as unknown as IOrderRecordService);

    await expect(
      controller.getSalesAnalytics({
        from: '1970-01-01T00:00:00.000Z',
        to: '2100-01-01T00:00:00.000Z',
      })
    ).rejects.toThrow(BadRequestException);
    expect(service.getSalesAndChannelAnalytics).not.toHaveBeenCalled();
  });
});
