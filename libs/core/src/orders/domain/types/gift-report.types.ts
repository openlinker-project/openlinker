/**
 * Gift Report Types (#3943)
 *
 * The flat facts behind the "Gift cost" report and its per-customer CSV, and the
 * pure grouping over them. One entry is one gift the order carries: either a
 * gift LINE (channel-sent, rule-added or added by hand) or a bundle GIFT SLOT
 * (a component of a set the operator marked as given free).
 *
 * Amounts stay in the ORDER's currency and are never added across currencies:
 * the report has no FX rate to apply, and an invented one would be a made-up cost.
 * An unknown cost is `null`, never `0` - a `0` would read as "free for you".
 *
 * @module libs/core/src/orders/domain/types
 */
import type { GiftDocumentForm, GiftSource } from './incoming-order.types';

/** Where a report entry comes from. */
export const GiftReportOriginValues = ['line', 'bundle-slot'] as const;
export type GiftReportOrigin = (typeof GiftReportOriginValues)[number];

/** `rule` = a promotion gave it; `manual` = an operator added it by hand. */
export const GiftReportSourceFilterValues = ['rule', 'manual'] as const;
export type GiftReportSourceFilter = (typeof GiftReportSourceFilterValues)[number];

/** Where the unit cost came from; `unknown` means no cost in the order's currency is on file. */
export type GiftCostBasis = 'snapshot' | 'catalogue' | 'unknown';

export interface GiftReportFilters {
  from: Date;
  to: Date;
  sourceConnectionId?: string;
  giftSource?: GiftReportSourceFilter;
}

export interface GiftReportEntry {
  internalOrderId: string;
  orderNumber: string | null;
  placedAt: Date | null;
  sourceConnectionId: string;
  /** The resolved customer, the same buyer across orders; `null` when none was resolved. */
  customerId: string | null;
  currency: string | null;
  /** The commercial line id (for a slot: the bundle line that carries it). */
  lineId: string;
  origin: GiftReportOrigin;
  /** `bundle` for a gift slot, otherwise the line's own {@link GiftSource}. */
  giftSource: GiftSource | 'bundle';
  ruleRef: string | null;
  documentForm: GiftDocumentForm | null;
  productId: string;
  variantId: string | null;
  sku: string | null;
  name: string | null;
  quantity: number;
  /** What the customer paid for the units, gross; `0` for a free gift. `null` for a bundle slot (paid inside the set). */
  paidGross: number | null;
  unitCostNet: number | null;
  totalCostNet: number | null;
  costBasis: GiftCostBasis;
}

/** A gift is "from a promotion" when a rule gave it, "by hand" when an operator did. */
export function isManualGiftEntry(entry: GiftReportEntry): boolean {
  return entry.giftSource === 'operator';
}

export function matchesGiftSourceFilter(
  entry: GiftReportEntry,
  filter: GiftReportSourceFilter | undefined
): boolean {
  if (filter === undefined) return true;
  return filter === 'manual' ? isManualGiftEntry(entry) : !isManualGiftEntry(entry);
}

export interface GiftReportGroup {
  /** Stable key: the rule, or `manual`, or `channel`, plus the gift variant. */
  key: string;
  giftSource: GiftSource | 'bundle';
  ruleRef: string | null;
  productId: string;
  variantId: string | null;
  sku: string | null;
  name: string | null;
  currency: string | null;
  units: number;
  orders: number;
  paidGross: number;
  /** Net purchase cost of the units whose cost is known. */
  costNet: number;
  /** Units with no cost on file; NOT in `costNet`. */
  unknownCostUnits: number;
}

export interface GiftReportTotals {
  currency: string | null;
  units: number;
  paidGross: number;
  costNet: number;
  unknownCostUnits: number;
}

export interface GiftReportSummary {
  groups: GiftReportGroup[];
  totals: GiftReportTotals[];
}

function groupKeyOf(entry: GiftReportEntry): string {
  const origin =
    entry.giftSource === 'ol-rule' && entry.ruleRef !== null
      ? `rule:${entry.ruleRef}`
      : entry.giftSource === 'operator'
        ? 'manual'
        : entry.giftSource === 'bundle'
          ? 'bundle'
          : `channel:${entry.ruleRef ?? ''}`;
  return `${origin}|${entry.variantId ?? entry.productId}|${entry.currency ?? ''}`;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Groups entries per promotion (or per manual add) and gift product, and totals
 * them per currency. Pure; the caller has already applied its filters.
 */
export function summarizeGiftReport(entries: readonly GiftReportEntry[]): GiftReportSummary {
  const groups = new Map<string, GiftReportGroup & { orderIds: Set<string> }>();
  for (const entry of entries) {
    const key = groupKeyOf(entry);
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        key,
        giftSource: entry.giftSource,
        ruleRef: entry.ruleRef,
        productId: entry.productId,
        variantId: entry.variantId,
        sku: entry.sku,
        name: entry.name,
        currency: entry.currency,
        units: 0,
        orders: 0,
        paidGross: 0,
        costNet: 0,
        unknownCostUnits: 0,
        orderIds: new Set<string>(),
      };
      groups.set(key, group);
    }
    group.units += entry.quantity;
    group.orderIds.add(entry.internalOrderId);
    group.paidGross += entry.paidGross ?? 0;
    if (entry.totalCostNet === null) {
      group.unknownCostUnits += entry.quantity;
    } else {
      group.costNet += entry.totalCostNet;
    }
  }

  const totals = new Map<string, GiftReportTotals>();
  const finished: GiftReportGroup[] = [];
  for (const { orderIds, ...group } of groups.values()) {
    const row: GiftReportGroup = {
      ...group,
      orders: orderIds.size,
      paidGross: round2(group.paidGross),
      costNet: round2(group.costNet),
    };
    finished.push(row);
    const currencyKey = row.currency ?? '';
    const total = totals.get(currencyKey) ?? {
      currency: row.currency,
      units: 0,
      paidGross: 0,
      costNet: 0,
      unknownCostUnits: 0,
    };
    total.units += row.units;
    total.paidGross += row.paidGross;
    total.costNet += row.costNet;
    total.unknownCostUnits += row.unknownCostUnits;
    totals.set(currencyKey, total);
  }

  finished.sort((a, b) => b.costNet - a.costNet || a.key.localeCompare(b.key));
  return {
    groups: finished,
    totals: [...totals.values()].map((t) => ({
      ...t,
      paidGross: round2(t.paidGross),
      costNet: round2(t.costNet),
    })),
  };
}

// ── Bundle view ──────────────────────────────────────────────────────────────

export interface BundleReportRow {
  bundleVariantId: string;
  sku: string | null;
  name: string | null;
  currency: string | null;
  unitsSold: number;
  /** Net of the line's tax rate; `null` for any unit whose rate is unknown, so a partial sum is never shown as whole. */
  revenueNet: number | null;
  /** Sum of the components' purchase cost; `null` while any component has none. */
  costNet: number | null;
  /** A component carries no purchase cost, so cost and margin are unknown. */
  componentCostMissing: boolean;
  hasGiftSlot: boolean;
  marginNet: number | null;
}

export interface BundleComponentDemandRow {
  variantId: string;
  sku: string | null;
  name: string | null;
  /** Units drawn by bundles in the period. */
  inBundles: number;
  /** Units sold as a plain line in the period. */
  alone: number;
}

export interface BundleReport {
  bundles: BundleReportRow[];
  demand: BundleComponentDemandRow[];
}
