/**
 * Order Line Cost Service
 *
 * Reads one order's line rows (the cost snapshot written at ingestion) and
 * classifies each against the Net Sales rules, so the figure matches analytics.
 * One `getVariantsByIds` call tells whether a variant has a cost NOW, which is
 * what separates `cost-entered-after-sale` from `no-cost`.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderLineCostService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import {
  ORDER_LINE_ITEM_REPOSITORY_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
} from '../../orders.tokens';
import { classifyLineCost } from '../../domain/order-line-cost-view';
import { deriveNetLineAmount } from '../../domain/types/net-sales-tax-rate.types';
import type { OrderLineCostsResult } from '../../domain/types/order-line-cost.types';
import type { IOrderLineCostService } from './order-line-cost.service.interface';

@Injectable()
export class OrderLineCostService implements IOrderLineCostService {
  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly orderRecords: OrderRecordRepositoryPort,
    @Inject(ORDER_LINE_ITEM_REPOSITORY_TOKEN)
    private readonly lineItems: OrderLineItemRepositoryPort,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService
  ) {}

  async getLineCosts(
    internalOrderId: string,
    includeBackfilledPreRollout = false
  ): Promise<OrderLineCostsResult | null> {
    const record = await this.orderRecords.findById(internalOrderId);
    if (!record) {
      return null;
    }
    const lines = await this.lineItems.findByOrderId(internalOrderId);
    if (lines.length === 0) {
      return { currency: record.currency, lines: [] };
    }

    const variantIds = [
      ...new Set(lines.map((l) => l.variantId).filter((id): id is string => id !== null)),
    ];
    const variants = variantIds.length > 0 ? await this.products.getVariantsByIds(variantIds) : [];
    const hasCostNow = new Set(
      variants.filter((v) => v.netUnitCost !== null && v.netUnitCost !== undefined).map((v) => v.id)
    );
    const skuByProduct = new Map<string, string>();
    for (const item of record.orderItems) {
      if (item.sku && !skuByProduct.has(item.productId)) {
        skuByProduct.set(item.productId, item.sku);
      }
    }

    const eraEligible = includeBackfilledPreRollout || record.taxRateEra !== 'pre-rollout';
    return {
      currency: record.currency,
      lines: lines.map((line) => {
        const netAmount = deriveNetLineAmount(
          line.unitPrice,
          line.quantity,
          line.taxRate,
          record.taxTreatment
        );
        const netEligible = eraEligible && netAmount !== null;
        const classified = classifyLineCost({
          variantId: line.variantId,
          costState: line.costState,
          unitCostNet: line.unitCostNet,
          unitCostCurrency: line.unitCostCurrency,
          orderCurrency: record.currency,
          variantHasCostNow: line.variantId !== null && hasCostNow.has(line.variantId),
          quantity: line.quantity,
          netAmount,
          netEligible,
        });
        return {
          lineNumber: line.lineNumber,
          productId: line.productId,
          variantId: line.variantId,
          sku: skuByProduct.get(line.productId) ?? null,
          quantity: line.quantity,
          netAmount: netAmount === null ? null : Math.round(netAmount * 100) / 100,
          costState: line.costState,
          unitCostNet: line.unitCostNet,
          unitCostCurrency: line.unitCostCurrency,
          netEligible,
          ...classified,
        };
      }),
    };
  }
}
