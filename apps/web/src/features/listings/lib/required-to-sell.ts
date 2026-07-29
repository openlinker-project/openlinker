/**
 * Required-to-sell preflight (FE mirror, #1842)
 *
 * Pure, side-effect-free client mirror of the CORE `checkRequiredToSell` stock
 * rule (`libs/core/src/listings/application/services/check-required-to-sell.ts`).
 * No network calls - it reads only the resolved stock value the shop Review
 * step already computes for display, so it can run before submit.
 *
 * Scope note: the CORE checker also covers weight/dimensions (WooCommerce
 * live-rate shipping needs both), but the bulk wizard has no weight/dimensions
 * input yet - that's a separate FE data gap (epic #1838's WC field-completeness
 * work), not something this preflight can fabricate. The shape below is kept
 * close to the CORE checker's `RequiredToSellIssue` so wiring those checks in
 * once the data exists is additive, not a rewrite.
 *
 * @module apps/web/src/features/listings/lib
 */

export type RequiredToSellIssueCode = 'OUT_OF_STOCK';

export interface RequiredToSellIssue {
  code: RequiredToSellIssueCode;
  message: string;
}

/**
 * Resolved stock <= 0 means the listing will publish but can't be purchased
 * until restocked (no backorder flag exists on the publish command yet, so -
 * same as the CORE checker - this always warns rather than only warning when
 * backorders are disallowed).
 */
export function checkShopLineSellability(resolvedStock: number): RequiredToSellIssue[] {
  if (resolvedStock <= 0) {
    return [
      {
        code: 'OUT_OF_STOCK',
        message: 'Out of stock - it will publish but cannot be purchased until restocked.',
      },
    ];
  }
  return [];
}
