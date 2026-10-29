/**
 * Cost Coverage Service
 *
 * Orchestrates the cost coverage reads (#3588, D27): resolves the reporting
 * currency once per read, computes the UTC window, fetches the raw figures from
 * the line-item repository and derives the percentages. Cost is never read from
 * the catalogue as a margin input - this only classifies and lists.
 *
 * @module libs/core/src/orders/application/services
 * @implements {ICostCoverageService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  type IReportingCurrencySettingsService,
} from '@openlinker/core/currency';
import { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import { ORDER_LINE_ITEM_REPOSITORY_TOKEN } from '../../orders.tokens';
import {
  COST_WORKLIST_SALES_WINDOW_DAYS,
  type CostCoverageResult,
  type CostSummary,
  type CostWorklistCountFilters,
  type CostWorklistFilters,
  type CostWorklistResult,
} from '../../domain/types/cost-coverage.types';
import type { SalesAnalyticsFilters } from '../../domain/types/order-sales-analytics.types';
import type { ICostCoverageService } from './cost-coverage.service.interface';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_VARIANTS = 3;

/**
 * Window of the last `days` UTC days, today included: `[start of (today - days
 * + 1), start of tomorrow)`. Exclusive end because the line-item scope is `<`.
 */
export function utcDaysWindow(days: number, now: Date): SalesAnalyticsFilters {
  const startOfTomorrow = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  );
  return { from: new Date(startOfTomorrow - days * DAY_MS), to: new Date(startOfTomorrow) };
}

const roundPct = (value: number): number => Math.round(value * 10) / 10;

@Injectable()
export class CostCoverageService implements ICostCoverageService {
  constructor(
    @Inject(ORDER_LINE_ITEM_REPOSITORY_TOKEN)
    private readonly lineItemRepository: OrderLineItemRepositoryPort,
    @Inject(REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN)
    private readonly reportingCurrencySettings: IReportingCurrencySettingsService
  ) {}

  async getCostCoverage(
    days: number,
    includeBackfilledPreRollout = false,
    now: Date = new Date()
  ): Promise<CostCoverageResult> {
    const currency = await this.reportingCurrencySettings.resolve();
    const window = utcDaysWindow(days, now);
    const [figures, topRows] = await Promise.all([
      this.lineItemRepository.getCostCoverageFigures(window, currency, includeBackfilledPreRollout),
      this.lineItemRepository.getTopVariantsWithoutCost(
        window,
        currency,
        TOP_VARIANTS,
        includeBackfilledPreRollout
      ),
    ]);

    const share = (amount: number): number | null =>
      figures.netSalesWithoutCost > 0 ? roundPct((amount / figures.netSalesWithoutCost) * 100) : null;
    const top3Sum = topRows.reduce((sum, row) => sum + row.netSales, 0);

    return {
      days,
      from: window.from,
      to: window.to,
      currency,
      soldVariantCount: figures.soldVariantCount,
      soldVariantsWithoutCost: figures.soldVariantsWithoutCost,
      netSales: figures.netSales,
      netSalesWithoutCost: figures.netSalesWithoutCost,
      coveragePct:
        figures.netSales > 0
          ? roundPct(((figures.netSales - figures.netSalesWithoutCost) / figures.netSales) * 100)
          : null,
      notInMarginNetSales: figures.gaps.reduce((sum, gap) => sum + gap.netAmount, 0),
      gapByReason: figures.gaps,
      top3: topRows.map((row) => ({ ...row, sharePct: share(row.netSales) })),
      top3SharePct: share(top3Sum),
      productOnlyNetSales: figures.productOnlyNetSales,
    };
  }

  async getWorklist(
    filters: CostWorklistFilters,
    options: { withTotal?: boolean; includeBackfilledPreRollout?: boolean; now?: Date } = {}
  ): Promise<CostWorklistResult> {
    const { withTotal = true, includeBackfilledPreRollout = false, now = new Date() } = options;
    const currency = await this.reportingCurrencySettings.resolve();
    const window = utcDaysWindow(COST_WORKLIST_SALES_WINDOW_DAYS, now);

    const rowsPromise = this.lineItemRepository.findCostWorklistRows(
      filters,
      window,
      currency,
      includeBackfilledPreRollout
    );
    if (!withTotal) {
      return { currency, items: await rowsPromise };
    }
    const countFilters: CostWorklistCountFilters = {
      tab: filters.tab,
      q: filters.q,
      channel: filters.channel,
    };
    const [items, total] = await Promise.all([
      rowsPromise,
      this.lineItemRepository.countCostWorklist(
        countFilters,
        window,
        currency,
        includeBackfilledPreRollout
      ),
    ]);
    return { currency, items, total };
  }

  async countWorklist(
    filters: CostWorklistCountFilters,
    includeBackfilledPreRollout = false,
    now: Date = new Date()
  ): Promise<number> {
    const currency = await this.reportingCurrencySettings.resolve();
    return this.lineItemRepository.countCostWorklist(
      filters,
      utcDaysWindow(COST_WORKLIST_SALES_WINDOW_DAYS, now),
      currency,
      includeBackfilledPreRollout
    );
  }

  getSummary(): Promise<CostSummary> {
    return this.lineItemRepository.getCostSummary();
  }
}
