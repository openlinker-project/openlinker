/**
 * MarginAnalyticsService Unit Tests (#3588)
 *
 * @module libs/core/src/orders/application/services
 */
import type { IReportingCurrencySettingsService } from '@openlinker/core/currency';
import type { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import type { MarginDailyRow } from '../../domain/types/order-margin-analytics.types';
import { MarginAnalyticsService } from './margin-analytics.service';

describe('MarginAnalyticsService', () => {
  const filters = {
    from: new Date('2026-09-01T00:00:00.000Z'),
    to: new Date('2026-09-08T00:00:00.000Z'),
  };

  const build = (): {
    service: MarginAnalyticsService;
    repository: jest.Mocked<
      Pick<
        OrderLineItemRepositoryPort,
        | 'getMarginDailyRows'
        | 'getMarginProductRanking'
        | 'getMarginVariantRows'
        | 'countUncoveredLines'
      >
    >;
    currency: jest.Mocked<Pick<IReportingCurrencySettingsService, 'resolve'>>;
  } => {
    const repository = {
      getMarginDailyRows: jest.fn(),
      getMarginProductRanking: jest.fn(),
      getMarginVariantRows: jest.fn(),
      countUncoveredLines: jest.fn(),
    };
    const currency = { resolve: jest.fn().mockResolvedValue('EUR') };
    const service = new MarginAnalyticsService(
      repository as unknown as OrderLineItemRepositoryPort,
      currency as unknown as IReportingCurrencySettingsService
    );
    return { service, repository, currency };
  };

  const dailyRow: MarginDailyRow = {
    day: '2026-09-02',
    sourceConnectionId: 'conn-a',
    netRevenue: 100,
    coveredNetRevenue: 100,
    costOfGoods: 70,
    gaps: [],
    excludedLineCount: 0,
  };

  it('resolves the reporting currency once and threads it and the opt-in into the repository', async () => {
    const { service, repository, currency } = build();
    repository.getMarginDailyRows.mockResolvedValue([dailyRow]);

    const result = await service.getMargin(filters, 'day', true);

    expect(currency.resolve).toHaveBeenCalledTimes(1);
    expect(repository.getMarginDailyRows).toHaveBeenCalledWith(filters, 'EUR', true);
    expect(result.currency).toBe('EUR');
    expect(result.headline.grossMargin).toBe(30);
  });

  it('defaults the backfilled pre-rollout opt-in to false', async () => {
    const { service, repository } = build();
    repository.getMarginDailyRows.mockResolvedValue([]);

    await service.getMargin(filters, 'week');

    expect(repository.getMarginDailyRows).toHaveBeenCalledWith(filters, 'EUR', false);
  });

  it('returns ranked product views with the paged total', async () => {
    const { service, repository } = build();
    repository.getMarginProductRanking.mockResolvedValue({
      rows: [
        {
          productId: 'p1',
          netRevenue: 100,
          coveredNetRevenue: 100,
          costOfGoods: 25,
          gaps: [],
          excludedLineCount: 0,
        },
      ],
      total: 9,
    });

    const result = await service.getMarginProducts(
      { ...filters, sortBy: 'grossMargin', limit: 5, offset: 0 },
      false
    );

    expect(result.total).toBe(9);
    expect(result.items[0]).toMatchObject({ productId: 'p1', grossMargin: 75, marginPct: 0.75 });
  });

  it('returns variant views, keeping the null-variant bucket', async () => {
    const { service, repository } = build();
    repository.getMarginVariantRows.mockResolvedValue([
      {
        variantId: null,
        netRevenue: 10,
        coveredNetRevenue: 0,
        costOfGoods: 0,
        gaps: [{ reason: 'no-variant', lineCount: 1, netAmount: 10 }],
        excludedLineCount: 0,
      },
    ]);

    const result = await service.getMarginProductVariants('p1', filters);

    expect(result.productId).toBe('p1');
    expect(result.variants[0].variantId).toBeNull();
    expect(result.variants[0].marginPct).toBeNull();
  });

  it('delegates the uncovered-line count with the resolved currency', async () => {
    const { service, repository } = build();
    repository.countUncoveredLines.mockResolvedValue(4);

    await expect(service.countUncoveredLines(filters, true)).resolves.toBe(4);
    expect(repository.countUncoveredLines).toHaveBeenCalledWith(filters, 'EUR', true);
  });
});
