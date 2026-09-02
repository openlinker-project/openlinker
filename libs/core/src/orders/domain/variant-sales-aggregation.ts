/**
 * Variant Sales Aggregation
 *
 * Pure domain logic for the per-product variant-sales drill-down (#2765) —
 * merges a product's per-variant ranking with its per-(variant, channel)
 * breakdown into the response shape. No I/O, no framework imports; mirrors
 * `top-products-aggregation.ts`'s role for the product-level read.
 *
 * @module libs/core/src/orders/domain
 */
import type {
  VariantChannelBreakdownRow,
  VariantRankingRow,
  VariantSalesResult,
  VariantSalesView,
} from './types/top-products.types';

export interface BuildVariantSalesInput {
  productId: string;
  ranking: VariantRankingRow[];
  breakdown: VariantChannelBreakdownRow[];
}

/**
 * Joins each ranking row to its own breakdown rows by `variantId` — `null`
 * included, since it is a real, distinct bucket (see
 * {@link VariantRankingRow}'s doc comment), not a value to filter out. A
 * ranking row with no matching breakdown rows (shouldn't happen given both
 * queries share scope, but defended rather than assumed) gets an empty
 * `channels: []` instead of throwing.
 */
export function buildVariantSales(input: BuildVariantSalesInput): VariantSalesResult {
  const breakdownByVariantId = new Map<string | null, VariantChannelBreakdownRow[]>();
  for (const row of input.breakdown) {
    const existing = breakdownByVariantId.get(row.variantId);
    if (existing) {
      existing.push(row);
    } else {
      breakdownByVariantId.set(row.variantId, [row]);
    }
  }

  const variants: VariantSalesView[] = input.ranking.map((row) => ({
    variantId: row.variantId,
    units: row.units,
    revenue: row.revenue,
    unconvertedRevenue: row.unconvertedRevenue,
    unconvertedOrderCount: row.unconvertedOrderCount,
    currency: row.currency,
    unconvertedCurrency: row.unconvertedCurrency,
    netRevenue: row.netRevenue,
    netExcludedRevenue: row.netExcludedRevenue,
    netExcludedLineCount: row.netExcludedLineCount,
    channels: breakdownByVariantId.get(row.variantId) ?? [],
  }));

  return { productId: input.productId, variants };
}
