/**
 * CostCoverageService Unit Tests (#3588)
 *
 * @module libs/core/src/orders/application/services
 */
import type { IReportingCurrencySettingsService } from '@openlinker/core/currency';
import type { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import type { CostCoverageRawFigures } from '../../domain/types/cost-coverage.types';
import { CostCoverageService, utcDaysWindow } from './cost-coverage.service';

const NOW = new Date('2026-10-29T15:30:00.000Z');

const figures = (overrides: Partial<CostCoverageRawFigures> = {}): CostCoverageRawFigures => ({
  soldVariantCount: 10,
  soldVariantsWithoutCost: 4,
  netSales: 1000,
  netSalesWithoutCost: 200,
  productOnlyNetSales: 5,
  gaps: [
    { reason: 'no-variant', lineCount: 1, netAmount: 5 },
    { reason: 'currency-mismatch', lineCount: 0, netAmount: 0 },
    { reason: 'cost-entered-after-sale', lineCount: 2, netAmount: 60 },
    { reason: 'no-cost', lineCount: 3, netAmount: 140 },
  ],
  ...overrides,
});

const build = () => {
  const repository = {
    getCostCoverageFigures: jest.fn(),
    getTopVariantsWithoutCost: jest.fn().mockResolvedValue([]),
    findCostWorklistRows: jest.fn().mockResolvedValue([]),
    countCostWorklist: jest.fn().mockResolvedValue(0),
    getCostSummary: jest.fn(),
  };
  const currency = { resolve: jest.fn().mockResolvedValue('PLN') };
  const service = new CostCoverageService(
    repository as unknown as OrderLineItemRepositoryPort,
    currency as unknown as IReportingCurrencySettingsService
  );
  return { service, repository, currency };
};

describe('utcDaysWindow', () => {
  it('should cover the last N UTC days with today included and an exclusive end', () => {
    const window = utcDaysWindow(30, NOW);
    expect(window.to.toISOString()).toBe('2026-10-30T00:00:00.000Z');
    expect(window.from.toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });

  it('should be a single UTC day for N=1 regardless of the time of day', () => {
    const window = utcDaysWindow(1, new Date('2026-10-29T23:59:59.999Z'));
    expect(window.from.toISOString()).toBe('2026-10-29T00:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-10-30T00:00:00.000Z');
  });
});

describe('CostCoverageService.getCostCoverage', () => {
  it('should resolve the currency once and pass the window and opt-in to both reads', async () => {
    const { service, repository, currency } = build();
    repository.getCostCoverageFigures.mockResolvedValue(figures());

    const result = await service.getCostCoverage(30, true, NOW);

    expect(currency.resolve).toHaveBeenCalledTimes(1);
    const window = { from: new Date('2026-09-30T00:00:00.000Z'), to: new Date('2026-10-30T00:00:00.000Z') };
    expect(repository.getCostCoverageFigures).toHaveBeenCalledWith(window, 'PLN', true);
    expect(repository.getTopVariantsWithoutCost).toHaveBeenCalledWith(window, 'PLN', 3, true);
    expect(result).toMatchObject({ days: 30, from: window.from, to: window.to, currency: 'PLN' });
  });

  it('should derive coveragePct from net sales and the sum of gaps for notInMarginNetSales', async () => {
    const { service, repository } = build();
    repository.getCostCoverageFigures.mockResolvedValue(figures());

    const result = await service.getCostCoverage(30, false, NOW);

    expect(result.coveragePct).toBe(80);
    expect(result.notInMarginNetSales).toBe(205);
    expect(result.gapByReason).toHaveLength(4);
    expect(result.productOnlyNetSales).toBe(5);
  });

  it('should report top3SharePct as the top 3 net sales over netSalesWithoutCost', async () => {
    const { service, repository } = build();
    repository.getCostCoverageFigures.mockResolvedValue(figures());
    repository.getTopVariantsWithoutCost.mockResolvedValue([
      { variantId: 'a', productId: 'p', netSales: 100 },
      { variantId: 'b', productId: 'p', netSales: 40 },
      { variantId: 'c', productId: 'q', netSales: 10 },
    ]);

    const result = await service.getCostCoverage(30, false, NOW);

    expect(result.top3SharePct).toBe(75);
    expect(result.top3.map((v) => v.sharePct)).toEqual([50, 20, 5]);
  });

  it('should return null percentages, never NaN, when there is nothing to divide by', async () => {
    const { service, repository } = build();
    repository.getCostCoverageFigures.mockResolvedValue(
      figures({ netSales: 0, netSalesWithoutCost: 0, gaps: [] })
    );

    const result = await service.getCostCoverage(7, false, NOW);

    expect(result.coveragePct).toBeNull();
    expect(result.top3SharePct).toBeNull();
    expect(result.notInMarginNetSales).toBe(0);
  });
});

describe('CostCoverageService.getWorklist', () => {
  const filters = { tab: 'sold' as const, limit: 20, offset: 0 };

  it('should read the sales columns over the fixed 30-day window and return the total', async () => {
    const { service, repository } = build();
    repository.countCostWorklist.mockResolvedValue(9);

    const result = await service.getWorklist(filters, { now: NOW });

    const window = { from: new Date('2026-09-30T00:00:00.000Z'), to: new Date('2026-10-30T00:00:00.000Z') };
    expect(repository.findCostWorklistRows).toHaveBeenCalledWith(filters, window, 'PLN', false);
    expect(repository.countCostWorklist).toHaveBeenCalledWith({ tab: 'sold' }, window, 'PLN', false);
    expect(result.total).toBe(9);
  });

  it('should skip the count and omit total (never 0) when withTotal is false', async () => {
    const { service, repository } = build();

    const result = await service.getWorklist(filters, { withTotal: false, now: NOW });

    expect(repository.countCostWorklist).not.toHaveBeenCalled();
    expect('total' in result).toBe(false);
  });

  it('should count without paging for the sibling count read', async () => {
    const { service, repository } = build();
    repository.countCostWorklist.mockResolvedValue(3);

    await expect(service.countWorklist({ tab: 'all', q: 'cup' }, true, NOW)).resolves.toBe(3);
    expect(repository.countCostWorklist).toHaveBeenCalledWith(
      { tab: 'all', q: 'cup' },
      expect.anything(),
      'PLN',
      true
    );
  });
});
