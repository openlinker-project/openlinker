/**
 * Gift Report Service (#3943)
 *
 * Reads the orders in a range page by page and turns every gift - a channel line
 * flagged as one, a rule- or hand-added overlay line, a bundle gift slot - into a
 * flat {@link GiftReportEntry}. The exact lines come off the domain entity (the
 * effective snapshot already has the overlay merged in), so the report
 * reconciles with what the order detail shows by construction rather than by a
 * second parse of the jsonb.
 *
 * **Cost.** A channel gift line carries the cost frozen at ingestion (D27, the
 * order-line snapshot) when it has one. A line the overlay added, and a bundle
 * slot, have no snapshot - the frozen expansion carries none either - so they
 * read the variant's cost now, unless the overlay entry froze one when the gift was granted (`snapshot`). The entry says which (`costBasis`); a cost in
 * another currency than the order's is treated as unknown, never converted.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IGiftReportService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import type { OrderRecord } from '../../domain/entities/order-record.entity';
import type { OrderLineItem } from '../../domain/entities/order-line-item.entity';
import { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import { OrderGiftReportReaderPort } from '../../domain/ports/order-gift-report-reader.port';
import { readLineGift } from '../../domain/types/incoming-order.types';
import { deriveNetLineAmount } from '../../domain/types/net-sales-tax-rate.types';
import {
  matchesGiftSourceFilter,
  type BundleComponentDemandRow,
  type BundleReport,
  type BundleReportComponent,
  type BundleReportRow,
  type GiftCostBasis,
  type GiftReportEntry,
  type GiftReportFilters,
} from '../../domain/types/gift-report.types';
import { ORDER_GIFT_REPORT_READER_TOKEN, ORDER_LINE_ITEM_REPOSITORY_TOKEN } from '../../orders.tokens';
import type { IGiftReportService } from './gift-report.service.interface';

const PAGE_SIZE = 200;
const round2 = (value: number): number => Math.round(value * 100) / 100;

interface VariantFacts {
  sku: string | null;
  name: string | null;
  cost: string | null;
  costCurrency: string | null;
}

/** A cost is comparable to the order's amounts only in the order's own currency. */
function unitCostIn(
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

@Injectable()
export class GiftReportService implements IGiftReportService {
  constructor(
    @Inject(ORDER_GIFT_REPORT_READER_TOKEN)
    private readonly orderRecords: OrderGiftReportReaderPort,
    @Inject(ORDER_LINE_ITEM_REPOSITORY_TOKEN)
    private readonly lineItems: OrderLineItemRepositoryPort,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService
  ) {}

  async listEntries(filters: GiftReportFilters): Promise<GiftReportEntry[]> {
    const entries: GiftReportEntry[] = [];
    for await (const page of this.pages({ ...filters, scope: 'gifts' })) {
      const snapshots = await this.lineItems.findByOrderIds(page.map((r) => r.internalOrderId));
      const facts = await this.loadVariantFacts(page);
      for (const record of page) {
        for (const entry of this.entriesOf(record, snapshots.get(record.internalOrderId) ?? [], facts)) {
          if (matchesGiftSourceFilter(entry, filters.giftSource)) {
            entries.push(entry);
          }
        }
      }
    }
    return entries;
  }

  async getBundleReport(filters: Omit<GiftReportFilters, 'giftSource'>): Promise<BundleReport> {
    const rows = new Map<
      string,
      BundleReportRow & { revenueKnown: boolean; componentRows: Map<string, BundleReportComponent> }
    >();
    const inBundles = new Map<string, number>();
    for await (const page of this.pages({ ...filters, scope: 'bundles' })) {
      const facts = await this.loadVariantFacts(page);
      for (const record of page) {
        for (const bundle of record.bundleLines) {
          const item = record.orderItems.find((candidate) => candidate.id === bundle.lineId);
          if (item === undefined) continue;
          const key = `${bundle.bundleVariantId}|${record.currency ?? ''}`;
          let row = rows.get(key);
          if (row === undefined) {
            row = {
              bundleVariantId: bundle.bundleVariantId,
              sku: item.sku ?? null,
              name: item.name ?? null,
              currency: record.currency,
              unitsSold: 0,
              revenueNet: 0,
              costNet: 0,
              componentCostMissing: false,
              hasGiftSlot: false,
              marginNet: null,
              giftCostNet: 0,
              components: [],
              revenueKnown: true,
              componentRows: new Map(),
            };
            rows.set(key, row);
          }
          row.unitsSold += item.quantity;
          const net = deriveNetLineAmount(item.price, item.quantity, item.taxRate, record.taxTreatment);
          if (net === null) {
            row.revenueKnown = false;
          } else {
            row.revenueNet = (row.revenueNet ?? 0) + net;
          }
          for (const component of bundle.components) {
            inBundles.set(component.variantId, (inBundles.get(component.variantId) ?? 0) + component.quantity);
            if (component.giftSlot === true) row.hasGiftSlot = true;
            const fact = facts.get(component.variantId);
            const unit = unitCostIn(fact?.cost, fact?.costCurrency, record.currency);
            if (unit === null) {
              row.componentCostMissing = true;
            } else {
              row.costNet = (row.costNet ?? 0) + unit * component.quantity;
              if (component.giftSlot === true) row.giftCostNet += unit * component.quantity;
            }
            const componentKey = component.variantId;
            const shown = row.componentRows.get(componentKey) ?? {
              variantId: component.variantId,
              productId: component.productId,
              sku: fact?.sku ?? null,
              name: fact?.name ?? null,
              units: 0,
              unitCostNet: unit,
              costNet: unit === null ? null : 0,
              giftSlot: component.giftSlot === true,
            };
            shown.units += component.quantity;
            if (unit !== null) shown.costNet = (shown.costNet ?? 0) + unit * component.quantity;
            row.componentRows.set(componentKey, shown);
          }
        }
      }
    }

    const bundles: BundleReportRow[] = [...rows.values()].map(({ revenueKnown, componentRows, ...row }) => {
      const revenueNet = revenueKnown ? round2(row.revenueNet ?? 0) : null;
      const costNet = row.componentCostMissing ? null : round2(row.costNet ?? 0);
      return {
        ...row,
        giftCostNet: round2(row.giftCostNet),
        components: [...componentRows.values()].map((component) => ({
          ...component,
          costNet: component.costNet === null ? null : round2(component.costNet),
        })),
        revenueNet,
        costNet,
        marginNet: revenueNet !== null && costNet !== null ? round2(revenueNet - costNet) : null,
      };
    });
    bundles.sort((a, b) => b.unitsSold - a.unitsSold || a.bundleVariantId.localeCompare(b.bundleVariantId));

    const componentIds = [...inBundles.keys()];
    const alone = await this.lineItems.getUnitsSoldByVariants(componentIds, {
      from: filters.from,
      to: filters.to,
      sourceConnectionId: filters.sourceConnectionId,
    });
    const variants = componentIds.length > 0 ? await this.products.getVariantsByIds(componentIds) : [];
    const productList =
      variants.length > 0
        ? await this.products.getProductsByIds([...new Set(variants.map((v) => v.productId))])
        : [];
    const productName = new Map(productList.map((p) => [p.id, p.name]));
    const variantById = new Map(variants.map((v) => [v.id, v]));
    const demand: BundleComponentDemandRow[] = componentIds
      .map((variantId) => {
        const variant = variantById.get(variantId);
        return {
          variantId,
          sku: variant?.sku ?? null,
          name: variant === undefined ? null : (productName.get(variant.productId) ?? null),
          inBundles: inBundles.get(variantId) ?? 0,
          alone: alone.get(variantId) ?? 0,
        };
      })
      .sort((a, b) => b.inBundles - a.inBundles || a.variantId.localeCompare(b.variantId));
    return { bundles, demand };
  }

  private async *pages(filters: {
    from: Date;
    to: Date;
    sourceConnectionId?: string;
    scope: 'gifts' | 'bundles';
  }): AsyncGenerator<OrderRecord[]> {
    let afterId: string | null = null;
    for (;;) {
      const page = await this.orderRecords.findForGiftReport(filters, { afterId, limit: PAGE_SIZE });
      if (page.length === 0) return;
      yield page;
      if (page.length < PAGE_SIZE) return;
      afterId = page[page.length - 1].internalOrderId;
    }
  }

  private async loadVariantFacts(records: readonly OrderRecord[]): Promise<Map<string, VariantFacts>> {
    const ids = new Set<string>();
    for (const record of records) {
      for (const item of record.orderItems) {
        if (item.variantId !== undefined) ids.add(item.variantId);
      }
      for (const bundle of record.bundleLines) {
        for (const component of bundle.components) {
          if (component.variantId !== '') ids.add(component.variantId);
        }
      }
    }
    if (ids.size === 0) return new Map();
    const variants = await this.products.getVariantsByIds([...ids]);
    const productList = await this.products.getProductsByIds([...new Set(variants.map((v) => v.productId))]);
    const productName = new Map(productList.map((p) => [p.id, p.name]));
    return new Map(
      variants.map((variant) => [
        variant.id,
        {
          sku: variant.sku,
          name: productName.get(variant.productId) ?? null,
          cost: variant.netUnitCost ?? null,
          costCurrency: variant.costCurrency ?? null,
        },
      ])
    );
  }

  private entriesOf(
    record: OrderRecord,
    snapshots: readonly OrderLineItem[],
    facts: ReadonlyMap<string, VariantFacts>
  ): GiftReportEntry[] {
    const channelIds = Array.isArray(record.channelSnapshot.items)
      ? (record.channelSnapshot.items as Array<{ id?: unknown }>).map((item) => item.id)
      : [];
    const snapshotByLine = new Map(snapshots.map((line) => [line.lineNumber, line]));
    const base = {
      internalOrderId: record.internalOrderId,
      orderNumber: record.orderNumber ?? null,
      placedAt: record.placedAt,
      sourceConnectionId: record.sourceConnectionId,
      customerId: record.customerId,
      currency: record.currency,
    };
    const out: GiftReportEntry[] = [];

    for (const item of record.orderItems) {
      const gift = readLineGift(item.gift);
      if (gift === undefined || item.quantity <= 0) continue;
      const fact = item.variantId === undefined ? undefined : facts.get(item.variantId);
      const frozen = snapshotByLine.get(channelIds.indexOf(item.id));
      let unit: number | null = null;
      let basis: GiftCostBasis = 'unknown';
      if (
        frozen !== undefined &&
        frozen.costState === 'recorded' &&
        frozen.productId === item.productId
      ) {
        unit = unitCostIn(frozen.unitCostNet, frozen.unitCostCurrency, record.currency);
        if (unit !== null) basis = 'snapshot';
      }
      const overlay = record.orderEdits?.addedLines?.[item.id];
      if (unit === null && overlay?.unitCostNet !== undefined) {
        // Frozen at grant time (ADR-080): preferred over today's catalogue cost.
        unit = unitCostIn(overlay.unitCostNet, overlay.unitCostCurrency, record.currency);
        if (unit !== null) basis = 'snapshot';
      }
      if (unit === null) {
        unit = unitCostIn(fact?.cost, fact?.costCurrency, record.currency);
        if (unit !== null) basis = 'catalogue';
      }
      out.push({
        ...base,
        lineId: item.id,
        origin: 'line',
        giftSource: gift.source,
        ruleRef: gift.ruleRef ?? null,
        documentForm: gift.documentForm ?? null,
        productId: item.productId,
        variantId: item.variantId ?? null,
        sku: item.sku ?? fact?.sku ?? null,
        name: item.name ?? fact?.name ?? null,
        quantity: item.quantity,
        paidGross: round2(item.price * item.quantity),
        unitCostNet: unit,
        totalCostNet: unit === null ? null : round2(unit * item.quantity),
        costBasis: basis,
      });
    }

    for (const bundle of record.bundleLines) {
      for (const component of bundle.components) {
        if (component.giftSlot !== true) continue;
        const fact = facts.get(component.variantId);
        const unit = unitCostIn(fact?.cost, fact?.costCurrency, record.currency);
        out.push({
          ...base,
          lineId: bundle.lineId,
          origin: 'bundle-slot',
          giftSource: 'bundle',
          ruleRef: null,
          documentForm: null,
          productId: component.productId,
          variantId: component.variantId === '' ? null : component.variantId,
          sku: fact?.sku ?? null,
          name: fact?.name ?? null,
          quantity: component.quantity,
          paidGross: null,
          unitCostNet: unit,
          totalCostNet: unit === null ? null : round2(unit * component.quantity),
          costBasis: unit === null ? 'unknown' : 'catalogue',
        });
      }
    }
    return out;
  }
}
