/**
 * Bulk wizard pricing/stock policy + blocker computation (#792 PR 3)
 *
 * Pure, side-effect-free helpers shared by the Resolve step (blocker compute)
 * and the Review step (computed value + provenance rendering). Kept isolated
 * from React so the policy maths are unit-testable without rendering.
 *
 * Resolution precedence: master → policy → per-row override (override wins).
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';
import type { EanMatchResult } from '../../api/listings.types';
import type {
  BulkRowBlocker,
  BulkValueSource,
  PricingPolicy,
  StockPolicy,
} from './bulk-wizard.types';

const PRICE_DECIMALS = 2;
const MARKUP_MIN_PERCENT = -100;
const MARKUP_MAX_PERCENT = 500;

export interface ResolvedPrice {
  value: number | null;
  source: BulkValueSource;
  blocker: 'no-master-price' | null;
}

export interface ResolvedStock {
  value: number | null;
  source: BulkValueSource;
  blocker: 'no-master-stock' | null;
}

/** Half-up rounding to `dp` decimals. Inputs here are non-negative (factor ≥ 0). */
export function roundHalfUp(value: number, dp = PRICE_DECIMALS): number {
  const factor = 10 ** dp;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function clampMarkupPercent(percent: number): number {
  return Math.min(MARKUP_MAX_PERCENT, Math.max(MARKUP_MIN_PERCENT, percent));
}

export function computeResolvedPrice(
  policy: PricingPolicy,
  masterPrice: number | null,
  override: BulkPerProductOverride,
): ResolvedPrice {
  if (override.price !== undefined) {
    return { value: override.price.amount, source: 'override', blocker: null };
  }
  switch (policy.mode) {
    case 'flat':
      return { value: policy.amount, source: 'policy', blocker: null };
    case 'markup': {
      if (masterPrice === null) {
        return { value: null, source: 'policy', blocker: 'no-master-price' };
      }
      const factor = 1 + clampMarkupPercent(policy.percent) / 100;
      return { value: roundHalfUp(masterPrice * factor), source: 'policy', blocker: null };
    }
    case 'use-master':
    default:
      if (masterPrice === null) {
        return { value: null, source: 'master', blocker: 'no-master-price' };
      }
      return { value: masterPrice, source: 'master', blocker: null };
  }
}

export function computeResolvedStock(
  policy: StockPolicy,
  masterStock: number | null,
  override: BulkPerProductOverride,
): ResolvedStock {
  if (override.stock !== undefined) {
    return { value: override.stock, source: 'override', blocker: null };
  }
  switch (policy.mode) {
    case 'flat':
      return { value: policy.value, source: 'policy', blocker: null };
    case 'cap': {
      if (masterStock === null) {
        return { value: null, source: 'policy', blocker: 'no-master-stock' };
      }
      // min(master, N); 0-stock can't publish on Allegro, so it blocks too.
      const value = Math.min(masterStock, policy.value);
      return { value, source: 'policy', blocker: value <= 0 ? 'no-master-stock' : null };
    }
    case 'use-master':
    default:
      if (masterStock === null || masterStock <= 0) {
        return { value: masterStock, source: 'master', blocker: 'no-master-stock' };
      }
      return { value: masterStock, source: 'master', blocker: null };
  }
}

export interface ComputeBlockersInput {
  hasVariant: boolean;
  /**
   * Per-variant category outcome. The Resolve step synthesizes `{ kind: 'no-ean' }`
   * for variant rows without a barcode (no BE call); `undefined` is treated
   * defensively as `no-match`.
   */
  categoryResult: EanMatchResult | undefined;
  pricingPolicy: PricingPolicy;
  stockPolicy: StockPolicy;
  masterPrice: number | null;
  masterStock: number | null;
  masterCurrency: string | null;
  batchCurrency: string;
  override: BulkPerProductOverride;
}

/**
 * Compute the co-occurring blocker set for a row. A row with an empty result
 * is ready. `no-variant` is exclusive (nothing else is meaningful without a
 * variant); all other blockers can co-occur.
 */
export function computeBlockers(input: ComputeBlockersInput): BulkRowBlocker[] {
  if (!input.hasVariant) return ['no-variant'];

  const blockers: BulkRowBlocker[] = [];

  // Category — an operator-picked category override clears the category blocker.
  const hasCategoryOverride = Boolean(input.override.overrides?.categoryId);
  if (!hasCategoryOverride) {
    const cat = input.categoryResult;
    if (!cat || cat.kind === 'no-match') {
      blockers.push('no-match');
    } else if (cat.kind === 'no-ean') {
      blockers.push('no-ean');
    } else if (cat.kind === 'multi-match') {
      blockers.push('multi-match');
    }
    // 'matched' → no category blocker
  }

  // Price / stock — override-aware via the resolvers above.
  const price = computeResolvedPrice(input.pricingPolicy, input.masterPrice, input.override);
  if (price.blocker) blockers.push(price.blocker);
  const stock = computeResolvedStock(input.stockPolicy, input.masterStock, input.override);
  if (stock.blocker) blockers.push(stock.blocker);

  // Currency mismatch only matters when the master price is actually consumed
  // (use-master / markup, no explicit price override). Under flat pricing or an
  // override the published price is already in the batch currency.
  const pricingUsesMaster =
    (input.pricingPolicy.mode === 'use-master' || input.pricingPolicy.mode === 'markup') &&
    input.override.price === undefined;
  if (
    pricingUsesMaster &&
    input.masterCurrency !== null &&
    input.masterCurrency !== input.batchCurrency
  ) {
    blockers.push('currency-mismatch');
  }

  return blockers;
}
