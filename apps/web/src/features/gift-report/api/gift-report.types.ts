/**
 * Gift report types (#3943)
 *
 * Mirror of `GET /analytics/gifts*`. Amounts are in the ORDER's currency and are
 * never converted, so totals come split per currency. A `null` cost is "not on
 * file", never zero.
 *
 * @module features/gift-report/api
 */
import type { MarginFilters } from '../../analytics';

export const GIFT_REPORT_SOURCE_VALUES = ['rule', 'manual'] as const;
export type GiftReportSource = (typeof GIFT_REPORT_SOURCE_VALUES)[number];

export type GiftReportFilters = MarginFilters & { giftSource?: GiftReportSource };

export interface GiftReportGroup {
  key: string;
  giftSource: string;
  ruleRef: string | null;
  ruleName: string | null;
  productId: string;
  variantId: string | null;
  sku: string | null;
  name: string | null;
  currency: string | null;
  units: number;
  orders: number;
  paidGross: number;
  costNet: number;
  unknownCostUnits: number;
}

export interface GiftReportTotals {
  currency: string | null;
  units: number;
  paidGross: number;
  costNet: number;
  unknownCostUnits: number;
}

export interface GiftReport {
  groups: GiftReportGroup[];
  totals: GiftReportTotals[];
}

export interface GiftBundleRow {
  bundleVariantId: string;
  sku: string | null;
  name: string | null;
  currency: string | null;
  unitsSold: number;
  revenueNet: number | null;
  costNet: number | null;
  componentCostMissing: boolean;
  hasGiftSlot: boolean;
  marginNet: number | null;
}

export interface GiftBundleDemandRow {
  variantId: string;
  sku: string | null;
  name: string | null;
  inBundles: number;
  alone: number;
  available: number | null;
}

export interface GiftBundleReport {
  bundles: GiftBundleRow[];
  demand: GiftBundleDemandRow[];
}
