/**
 * Gift Report API Service (#3943)
 *
 * @module apps/api/src/analytics/application/services
 * @implements {IGiftReportApiService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { PROMOTION_SERVICE_TOKEN, type IPromotionService } from '@openlinker/core/promotions';
import {
  CUSTOMER_PROJECTION_SERVICE_TOKEN,
  type ICustomerProjectionService,
} from '@openlinker/core/customers';
import { INVENTORY_QUERY_SERVICE_TOKEN, type IInventoryQueryService } from '@openlinker/core/inventory';
import {
  GIFT_REPORT_SERVICE_TOKEN,
  bucketGiftCosts,
  summarizeGiftReport,
  type GiftReportEntry,
  type GiftReportFilters,
  type IGiftReportService,
} from '@openlinker/core/orders';
import type {
  BundleReportResponseDto,
  GiftReportResponseDto,
} from '../../http/dto/gift-report.dto';
import type {
  GiftCustomerExportRow,
  IGiftReportApiService,
} from './gift-report-api.service.interface';

@Injectable()
export class GiftReportApiService implements IGiftReportApiService {
  constructor(
    @Inject(GIFT_REPORT_SERVICE_TOKEN) private readonly report: IGiftReportService,
    @Inject(PROMOTION_SERVICE_TOKEN) private readonly rules: IPromotionService,
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN) private readonly inventory: IInventoryQueryService,
    @Inject(CUSTOMER_PROJECTION_SERVICE_TOKEN)
    private readonly customers: ICustomerProjectionService
  ) {}

  async getReport(filters: GiftReportFilters): Promise<GiftReportResponseDto> {
    const entries = await this.report.listEntries(filters);
    const summary = summarizeGiftReport(entries);
    const names = await this.ruleNames();
    return {
      groups: summary.groups.map((group) => ({
        key: group.key,
        giftSource: group.giftSource,
        ruleRef: group.ruleRef,
        ruleName: group.ruleRef === null ? null : (names.get(group.ruleRef) ?? null),
        productId: group.productId,
        variantId: group.variantId,
        sku: group.sku,
        name: group.name,
        currency: group.currency,
        units: group.units,
        orders: group.orders,
        paidGross: group.paidGross,
        costNet: group.costNet,
        unknownCostUnits: group.unknownCostUnits,
        sourceConnectionIds: group.sourceConnectionIds,
      })),
      totals: summary.totals,
      series: bucketGiftCosts(entries, filters.from, filters.to),
    };
  }

  async getBundleReport(
    filters: Omit<GiftReportFilters, 'giftSource'>
  ): Promise<BundleReportResponseDto> {
    const bundle = await this.report.getBundleReport(filters);
    const availability =
      bundle.demand.length === 0
        ? []
        : await this.inventory.getAvailabilityByVariantIds(bundle.demand.map((row) => row.variantId));
    const byVariant = new Map(availability.map((row) => [row.productVariantId, row.availableToPromise]));
    return {
      bundles: bundle.bundles,
      demand: bundle.demand.map((row) => ({
        ...row,
        available: byVariant.get(row.variantId) ?? null,
      })),
    };
  }

  async getCustomerExportRows(filters: GiftReportFilters): Promise<GiftCustomerExportRow[]> {
    const entries = (await this.report.listEntries(filters)).sort(compareByPlacedAt);
    const names = await this.ruleNames();
    const customerIds = [
      ...new Set(entries.map((entry) => entry.customerId).filter((id): id is string => id !== null)),
    ];
    const projections = await this.customers.getProjectionsByIds(customerIds);
    const customerNames = new Map<string, string | null>();
    for (const id of customerIds) {
      const projection = projections.get(id);
      const name = [projection?.firstName, projection?.lastName].filter(Boolean).join(' ');
      customerNames.set(id, name === '' ? null : name);
    }
    return entries.map((entry) => ({
      entry,
      customerName: entry.customerId === null ? null : (customerNames.get(entry.customerId) ?? null),
      ruleName: entry.ruleRef === null ? null : (names.get(entry.ruleRef) ?? null),
    }));
  }

  private async ruleNames(): Promise<Map<string, string>> {
    const views = await this.rules.list();
    return new Map(views.map((view) => [view.promotion.id, view.promotion.name]));
  }
}

function compareByPlacedAt(a: GiftReportEntry, b: GiftReportEntry): number {
  const left = a.placedAt?.getTime() ?? 0;
  const right = b.placedAt?.getTime() ?? 0;
  return left - right || a.internalOrderId.localeCompare(b.internalOrderId);
}
