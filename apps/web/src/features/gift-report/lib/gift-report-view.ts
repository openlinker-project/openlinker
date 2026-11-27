/**
 * Gift report view helpers
 *
 * Pure shaping of the report for the screen: regrouping the per-promotion rows
 * by gift product and the chart axis.
 *
 * @module features/gift-report/lib
 */
import type { GiftReportGroup } from '../api/gift-report.types';

/** One gift product with everything given of it, across promotions and manual adds. */
export interface GiftProductRow {
  key: string;
  productId: string;
  variantId: string | null;
  sku: string | null;
  name: string | null;
  currency: string | null;
  units: number;
  /** Sum of the groups' orders; an order with two promotions of one gift counts in each. */
  orders: number;
  costNet: number;
  unknownCostUnits: number;
  sourceConnectionIds: string[];
}

/** Regroups the per-promotion rows by gift product (and currency, which is never added across). */
export function groupByGiftProduct(groups: readonly GiftReportGroup[]): GiftProductRow[] {
  const rows = new Map<string, GiftProductRow>();
  for (const group of groups) {
    const key = `${group.variantId ?? group.productId}|${group.currency ?? ''}`;
    const row = rows.get(key) ?? {
      key,
      productId: group.productId,
      variantId: group.variantId,
      sku: group.sku,
      name: group.name,
      currency: group.currency,
      units: 0,
      orders: 0,
      costNet: 0,
      unknownCostUnits: 0,
      sourceConnectionIds: [],
    };
    row.units += group.units;
    row.orders += group.orders;
    row.costNet += group.costNet;
    row.unknownCostUnits += group.unknownCostUnits;
    row.sourceConnectionIds = [...new Set([...row.sourceConnectionIds, ...group.sourceConnectionIds])];
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.costNet - a.costNet || a.key.localeCompare(b.key));
}

const NICE_STEPS = [5, 10, 20, 25, 50, 100, 150, 200, 250, 500, 1000, 2000, 5000, 10000];

/**
 * A y axis of four equal intervals whose top is at least the tallest bar, with
 * a round step so the labels read as numbers a person would pick.
 */
export function niceAxis(max: number): { top: number; ticks: number[] } {
  const wanted = Math.max(max, 1) / 4;
  const step =
    NICE_STEPS.find((candidate) => candidate >= wanted) ?? Math.ceil(wanted / 1000) * 1000;
  return { top: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => step * i) };
}
