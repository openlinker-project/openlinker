/**
 * Order Bundle Document Service (#3934)
 *
 * Reads the components of an order's bundle lines from the frozen expansion and
 * decorates them with names, standalone prices and cost. The price and cost are
 * read NOW (the frozen expansion carries no prices), which is only used as a
 * ratio to split what was paid, so a later price change cannot move a document
 * total. Gift slots are read from the expansion, never from a rule.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderBundleDocumentService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import type {
  BundleDocumentPresentation,
  DocumentBundleComponent,
} from '@openlinker/core/sales-documents';
import type { OrderRecord } from '../../domain/entities/order-record.entity';
import type {
  GiftSlotCostLine,
  IOrderBundleDocumentService,
} from './order-bundle-document.service.interface';

@Injectable()
export class OrderBundleDocumentService implements IOrderBundleDocumentService {
  constructor(
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService
  ) {}

  async resolveForDocuments(
    record: OrderRecord,
    _sourceConnectionId: string
  ): Promise<BundleDocumentPresentation | undefined> {
    const bundles = record.bundleLines;
    if (bundles.length === 0) {
      return undefined;
    }
    // A failed read is NOT answered with a different document shape: whether a
    // set is one line or its components is a fiscal fact, and falling back to
    // one line after a transient error would issue a document the data does not
    // support. The error propagates, so issuance retries or reports it.
    const details = await this.loadDetails(bundles.flatMap((b) => b.components));
    const byLineId: Record<string, DocumentBundleComponent[]> = {};
    for (const bundle of bundles) {
      byLineId[bundle.lineId] = bundle.components.map((component) => {
        const detail = details.get(component.variantId);
        const cost = costInCurrency(detail?.cost, detail?.costCurrency, record.currency);
        return {
          lineId: component.lineId,
          variantId: component.variantId,
          productId: component.productId,
          name: detail?.name ?? null,
          sku: detail?.sku ?? null,
          quantity: component.quantity,
          ...(component.giftSlot === true && { giftSlot: true }),
          ...(detail?.price !== undefined && { unitPriceGross: detail.price }),
          ...(cost !== null && { unitCostNet: cost }),
          ...(detail?.taxRate != null && { taxRate: detail.taxRate }),
        };
      });
    }
    return { byLineId };
  }

  async getGiftSlotCosts(record: OrderRecord): Promise<GiftSlotCostLine[]> {
    const gifts = record.bundleLines.flatMap((bundle) =>
      bundle.components
        .filter((component) => component.giftSlot === true)
        .map((component) => ({ lineId: bundle.lineId, component }))
    );
    if (gifts.length === 0) {
      return [];
    }
    const details = await this.loadDetails(gifts.map((g) => g.component));
    return gifts.map(({ lineId, component }) => {
      const detail = details.get(component.variantId);
      const unit = costInCurrency(detail?.cost, detail?.costCurrency, record.currency);
      return {
        lineId,
        componentLineId: component.lineId,
        variantId: component.variantId,
        quantity: component.quantity,
        unitCostNet: detail?.cost ?? null,
        costCurrency: detail?.costCurrency ?? null,
        totalCostNet: unit === null ? null : Math.round(unit * component.quantity * 100) / 100,
      };
    });
  }

  private async loadDetails(
    components: readonly { variantId: string }[]
  ): Promise<
    Map<
      string,
      {
        name: string | null;
        sku: string | null;
        price?: number;
        taxRate?: string | null;
        cost: string | null;
        costCurrency: string | null;
      }
    >
  > {
    const variantIds = [...new Set(components.map((c) => c.variantId))];
    const variants = await this.products.getVariantsByIds(variantIds);
    const productList = await this.products.getProductsByIds([
      ...new Set(variants.map((v) => v.productId)),
    ]);
    const productById = new Map(productList.map((p) => [p.id, p]));
    return new Map(
      variants.map((variant) => {
        const product = productById.get(variant.productId);
        const price = variant.price ?? product?.price;
        return [
          variant.id,
          {
            name: product?.name ?? null,
            sku: variant.sku,
            ...(typeof price === 'number' && { price }),
            // Catalogue rate (ADR-063): the variant's own, else its product's.
            taxRate: variant.taxRate ?? product?.taxRate ?? null,
            cost: variant.netUnitCost ?? null,
            costCurrency: variant.costCurrency ?? null,
          },
        ];
      })
    );
  }
}

/** A cost is comparable to the order's amounts only in the order's own currency. */
function costInCurrency(
  cost: string | null | undefined,
  costCurrency: string | null | undefined,
  orderCurrency: string | null
): number | null {
  if (cost === null || cost === undefined || costCurrency !== orderCurrency) {
    return null;
  }
  const value = Number(cost);
  return Number.isFinite(value) ? value : null;
}
