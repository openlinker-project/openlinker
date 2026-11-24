/**
 * Product Cost Reads Service (#3588)
 *
 * Lives at the apps/api layer for the reason `TopProductsService` does: core
 * `orders` owns the figures but must not depend on `products` or on the
 * connection catalogue for display metadata. Cost is only ever LISTED here;
 * no margin figure is derived from the catalogue.
 *
 * @module apps/api/src/products/application/services
 * @implements {IProductCostReadsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN,
  type IAnalyticsDisplaySettingsService,
} from '@openlinker/core/analytics';
import {
  COST_COVERAGE_SERVICE_TOKEN,
  type CostWorklistCountFilters,
  type CostWorklistFilters,
  type ICostCoverageService,
} from '@openlinker/core/orders';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../../../integrations/application/interfaces/connection.service.interface';
import {
  CostCoverageResponseDto,
  CostCoverageTopVariantDto,
  CostSummaryResponseDto,
  CostWorklistResponseDto,
  CostWorklistRowDto,
  CostWorklistSoldOnDto,
} from '../../http/dto/cost-coverage.dto';
import type { IProductCostReadsService } from './product-cost-reads.service.interface';

@Injectable()
export class ProductCostReadsService implements IProductCostReadsService {
  constructor(
    @Inject(COST_COVERAGE_SERVICE_TOKEN)
    private readonly costCoverage: ICostCoverageService,
    @Inject(ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN)
    private readonly displaySettings: IAnalyticsDisplaySettingsService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connectionService: IConnectionService
  ) {}

  async getCostCoverage(days: number): Promise<CostCoverageResponseDto> {
    const { includeBackfilledTaxRatesInNetSales } = await this.displaySettings.getSettings();
    const core = await this.costCoverage.getCostCoverage(days, includeBackfilledTaxRatesInNetSales);

    const variants = await this.productsService.getVariantsByIds(core.top3.map((v) => v.variantId));
    const variantById = new Map(variants.map((v) => [v.id, v]));
    const products = await this.productsService.getProductsByIds(core.top3.map((v) => v.productId));
    const productById = new Map(products.map((p) => [p.id, p]));

    const dto = new CostCoverageResponseDto();
    dto.days = core.days;
    dto.from = core.from.toISOString();
    dto.to = core.to.toISOString();
    dto.currency = core.currency;
    dto.soldVariantCount = core.soldVariantCount;
    dto.soldVariantsWithoutCost = core.soldVariantsWithoutCost;
    dto.netSales = core.netSales;
    dto.netSalesWithoutCost = core.netSalesWithoutCost;
    dto.coveragePct = core.coveragePct;
    dto.notInMarginNetSales = core.notInMarginNetSales;
    dto.gapByReason = core.gapByReason.map((g) => ({
      reason: g.reason,
      lineCount: g.lineCount,
      netAmount: g.netAmount,
    }));
    dto.top3 = core.top3.map((row) => {
      const variant = variantById.get(row.variantId);
      const top = new CostCoverageTopVariantDto();
      top.variantId = row.variantId;
      top.productId = row.productId;
      top.name = productById.get(row.productId)?.name ?? null;
      top.sku = variant?.sku ?? null;
      top.attributes = variant?.attributes ?? null;
      top.netSales = row.netSales;
      return top;
    });
    dto.top3SharePct = core.top3SharePct;
    dto.productOnlyNetSales = core.productOnlyNetSales;
    return dto;
  }

  async getSummary(): Promise<CostSummaryResponseDto> {
    const summary = await this.costCoverage.getSummary();
    const dto = new CostSummaryResponseDto();
    dto.variantsWithoutCost = summary.variantsWithoutCost;
    dto.productsWithoutCost = summary.productsWithoutCost;
    dto.variantsWithCost = summary.variantsWithCost;
    return dto;
  }

  async getWorklist(
    filters: CostWorklistFilters,
    withTotal: boolean
  ): Promise<CostWorklistResponseDto> {
    const { includeBackfilledTaxRatesInNetSales } = await this.displaySettings.getSettings();
    const core = await this.costCoverage.getWorklist(filters, {
      withTotal,
      includeBackfilledPreRollout: includeBackfilledTaxRatesInNetSales,
    });

    const connectionIds = [...new Set(core.items.flatMap((row) => row.soldOnConnectionIds))];
    const connectionById = new Map<string, { platformType: string; name: string }>();
    if (connectionIds.length > 0) {
      const connections = await this.connectionService.list();
      for (const connection of connections) {
        connectionById.set(connection.id, {
          platformType: connection.platformType,
          name: connection.name,
        });
      }
    }

    const dto = new CostWorklistResponseDto();
    dto.currency = core.currency;
    dto.items = core.items.map((row) => {
      const item = new CostWorklistRowDto();
      item.variantId = row.variantId;
      item.productId = row.productId;
      item.productName = row.productName;
      item.sku = row.sku;
      item.attributes = row.attributes;
      item.netUnitCost = row.netUnitCost;
      item.costCurrency = row.costCurrency;
      item.costUpdatedAt = row.costUpdatedAt ? row.costUpdatedAt.toISOString() : null;
      item.netSales30d = row.netSales30d;
      item.units30d = row.units30d;
      item.soldOn = row.soldOnConnectionIds.map((connectionId) => {
        const soldOn = new CostWorklistSoldOnDto();
        const connection = connectionById.get(connectionId);
        soldOn.connectionId = connectionId;
        soldOn.platformType = connection?.platformType ?? null;
        soldOn.name = connection?.name ?? null;
        return soldOn;
      });
      return item;
    });
    if (core.total !== undefined) {
      dto.total = core.total;
    }
    return dto;
  }

  async countWorklist(filters: CostWorklistCountFilters): Promise<number> {
    const { includeBackfilledTaxRatesInNetSales } = await this.displaySettings.getSettings();
    return this.costCoverage.countWorklist(filters, includeBackfilledTaxRatesInNetSales);
  }
}
