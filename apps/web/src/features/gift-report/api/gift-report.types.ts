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
  /** Channels (source connection ids) that sent the orders carrying this gift. */
  sourceConnectionIds: string[];
}

export interface GiftReportTotals {
  currency: string | null;
  /** Distinct orders carrying at least one gift. */
  orders: number;
  units: number;
  paidGross: number;
  costNet: number;
  unknownCostUnits: number;
}

export type GiftCostGranularity = 'day' | 'week';

export interface GiftCostPoint {
  /** Start of the bucket, ISO 8601. */
  start: string;
  costNet: number;
  units: number;
  unknownCostUnits: number;
  /** The bucket runs past the end of the range (a week in progress). */
  partial: boolean;
}

export interface GiftCostSeries {
  currency: string | null;
  granularity: GiftCostGranularity;
  points: GiftCostPoint[];
}

export interface GiftReport {
  groups: GiftReportGroup[];
  totals: GiftReportTotals[];
  series: GiftCostSeries[];
}

export interface GiftBundleComponent {
  variantId: string;
  productId: string;
  sku: string | null;
  name: string | null;
  units: number;
  unitCostNet: number | null;
  costNet: number | null;
  giftSlot: boolean;
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
  giftCostNet: number;
  components: GiftBundleComponent[];
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
