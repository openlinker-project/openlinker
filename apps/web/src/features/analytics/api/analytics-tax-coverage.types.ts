/**
 * Analytics Tax Coverage types
 *
 * Mirrors `TaxCoverageOrderDto` / `TaxCoverageOrdersResponseDto`
 * (`GET /analytics/coverage/tax/orders`) and `TaxRerunBackfillRequestDto` /
 * `TaxRerunBackfillResponseDto` (`POST /analytics/coverage/tax/rerun-backfill`,
 * #2469) — the tax A/B/C category's paginated drill-downs plus the one
 * genuinely-write category-C action, added for the Data Coverage panel
 * (#2474, Phase 7).
 *
 * @module features/analytics/api
 */
import type { CoverageCategory } from './analytics-coverage.types';

/** Tax A/B/C only — never `'currency'` / `'product-matching'`. */
export type TaxCoverageCategory = Extract<CoverageCategory, 'tax-a' | 'tax-b' | 'tax-c'>;

/**
 * Mirrors `TaxRateState` (`@openlinker/core/products`) — the frontend cannot import core (#591).
 * Kept honest by `scripts/check-tax-rate-state-mirror.mjs` under `pnpm check:invariants` (#2802
 * review): a member added to core's `TaxRateStateValues` and not here now fails the build instead
 * of silently falling through `describeLineRate`'s render fallback.
 */
export type TaxCoverageLineRateState = 'not-checked' | 'no-rate' | 'known';

/**
 * Mirrors `TaxRateUnknownReason` (`@openlinker/core/products`) — display-only provenance for the
 * `'no-rate'` state (#2264), never control flow. Local to this feature rather than reached through
 * `features/products`' own copy of the same union (`products.types.ts`), matching the sibling
 * `TaxCoverageLineRateState` mirror above — both are small, closed, display-only vocabularies this
 * feature does not otherwise depend on `products` for.
 */
export type TaxCoverageLineRateUnknownReason = 'not-configured' | 'ambiguous' | 'unreadable';

/**
 * One line's resolved (or unresolved) rate observation (#2798), mirroring
 * `TaxCoverageLineRateDto` — carried per line so a mixed-rate order's
 * modal row never collapses to a single shared value.
 */
export interface TaxCoverageLineRate {
  productId: string;
  variantId: string | null;
  /** Resolved rate code, or `null` unless `state === 'known'`. */
  rateCode: string | null;
  state: TaxCoverageLineRateState;
  /** Why the catalogue named no rate — set only when `state === 'no-rate'` and the catalogue gave a reason. */
  unknownReason?: TaxCoverageLineRateUnknownReason | null;
}

export interface TaxCoverageOrder {
  internalOrderId: string;
  sourceConnectionId: string;
  /** `null` for a historical row with no resolvable placement date. */
  placedAt: string | null;
  /** Per-line rate observations for every one of the order's lines — never a single order-level rate. */
  lineRates: TaxCoverageLineRate[];
}

export interface TaxCoverageOrdersPage {
  items: TaxCoverageOrder[];
  total: number;
}

export interface GetTaxCoverageOrdersInput {
  category: TaxCoverageCategory;
  /** ISO 8601, inclusive. */
  from: string;
  /** ISO 8601, exclusive. */
  to: string;
  sourceConnectionId?: string;
  limit?: number;
  offset?: number;
}

export interface RerunTaxBackfillInput {
  internalOrderIds: string[];
}

export interface RerunTaxBackfillResult {
  /** Rate-less lines examined across every requested order. */
  scanned: number;
  /** Of those, lines the current catalogue resolved a rate for and wrote. */
  updated: number;
}
