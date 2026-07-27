/**
 * Required-to-Sell Preflight Checker
 *
 * Pure, side-effect-free function: given the already-resolved stock/weight/
 * dimensions of a shop publish, reports "would publish but not be sellable"
 * signals (#1842). No I/O — callers (the publish builder today; a future
 * FE-side or HTTP preflight once the input is available client-side) supply
 * data they already have.
 *
 * MVP scope: stock purchasability and the two WooCommerce live-rate-shipping
 * inputs (weight, dimensions). No backorder flag exists yet on
 * `PublishProductCommand`, so a zero stock always warns rather than only
 * warning when backorders are disallowed — documented gap, not a bug.
 *
 * @module libs/core/src/listings/application/services
 */

import type {
  RequiredToSellCheckInput,
  RequiredToSellIssue,
} from '../../domain/types/required-to-sell.types';

export function checkRequiredToSell(input: RequiredToSellCheckInput): RequiredToSellIssue[] {
  const issues: RequiredToSellIssue[] = [];

  if (input.stock <= 0) {
    issues.push({
      code: 'OUT_OF_STOCK',
      severity: 'warn',
      field: 'stock',
      message:
        'Stock is 0 - the listing will publish but cannot be purchased until restocked (backorders are not supported yet).',
    });
  }

  if (input.weight == null) {
    issues.push({
      code: 'MISSING_WEIGHT',
      severity: 'warn',
      field: 'weight',
      message:
        'Weight is not set - a weight-based shipping method (e.g. WooCommerce live-rate shipping) cannot quote a rate at checkout.',
    });
  }

  const dimensions = input.dimensions;
  const hasAnyDimension =
    dimensions != null &&
    (dimensions.length != null || dimensions.width != null || dimensions.height != null);
  if (!hasAnyDimension) {
    issues.push({
      code: 'MISSING_DIMENSIONS',
      severity: 'warn',
      field: 'commerce.dimensions',
      message:
        'Dimensions are not set - a dimensional shipping method cannot quote a rate at checkout.',
    });
  }

  return issues;
}
