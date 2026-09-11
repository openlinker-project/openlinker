/**
 * Price Changes API Types (#3145 backend contract, #3147)
 *
 * Mirrors `apps/api/src/listings/http/dto/*` verbatim — every field the
 * mockup (`docs/plans/mockups/price-changes-review-queue.html`) renders is
 * present here.
 *
 * @module apps/web/src/features/price-changes/api
 */

export type PricingRuleType = 'passthrough' | 'markup' | 'margin';
export type PriceRoundingMode = 'none' | 'nearestWhole' | 'endingIn99';
export type PriceSyncMode = 'manual' | 'automatic';
export type PriceChangeBlockReason = 'currency-mismatch';
export type PriceChangeResolution = 'accepted' | 'accepted-custom' | 'ignored';

export interface PriceChangeRuleSummary {
  type: PricingRuleType;
  percent: number;
  rounding: PriceRoundingMode;
}

export interface PriceChangeItem {
  id: string;
  productVariantId: string;
  productName: string;
  variantLabel: string | null;
  sku: string | null;

  sourceConnectionId: string;
  sourceLabel: string;
  sourceOldAmount: number;
  sourceNewAmount: number;
  sourceCurrency: string;

  destinationConnectionId: string;
  destinationLabel: string;
  /** `null` when unresolvable (mirrors `blockReason: 'destination-currency-unknown'`, #3163). */
  destinationCurrency: string | null;

  /** `null` when this episode has no recorded baseline (a brand-new mapping's first detection, #3159/#3162). */
  computedOldAmount: number | null;
  computedNewAmount: number;
  /** `null` exactly when `computedOldAmount` is `null` — there is no baseline to compute a delta against. */
  deltaPct: number | null;
  isSteep: boolean;

  ruleSummary: PriceChangeRuleSummary;

  blockReason: PriceChangeBlockReason | null;
  needsRefresh: boolean;
  version: string;

  manualPriceOverride: number | null;
  resolution: PriceChangeResolution | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  detectedAt: string;
}

export interface PriceChangeListResponse {
  items: PriceChangeItem[];
  hiddenStaleCount: number;
  /** Total open episodes matching the same filters — the real count behind pagination (#3162). */
  total: number;
}

export interface ListPriceChangesFilters {
  connectionId?: string;
  direction?: 'up' | 'down';
  magnitudeLarge?: boolean;
  /** Page size (server default 50, max 200 — #3162). */
  limit?: number;
  /** Rows to skip (#3162). */
  offset?: number;
}

export interface AcceptPriceChangeInput {
  optInAutomatic?: boolean;
  expectedVersion?: string;
}

export interface EditPriceChangeInput {
  manualPriceOverride: number;
  optInAutomatic?: boolean;
  expectedVersion?: string;
}

export interface BulkAcceptPriceChangeItem {
  id: string;
  optInAutomatic?: boolean;
}

export interface BulkAcceptPriceChangesResponse {
  batchId: string;
  totalCount: number;
}

export interface PriceChangeAutoAppliedItem {
  id: string;
  productVariantId: string;
  destinationConnectionId: string;
  sourceConnectionId: string;
  /** `null` for a first-ever detection with no recorded baseline (#3159). */
  oldAmount: number | null;
  newAmount: number;
  currency: string;
  appliedAt: string;
}
