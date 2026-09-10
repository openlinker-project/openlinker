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
  destinationCurrency: string;

  computedOldAmount: number;
  computedNewAmount: number;
  deltaPct: number;
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
}

export interface ListPriceChangesFilters {
  connectionId?: string;
  direction?: 'up' | 'down';
  magnitudeLarge?: boolean;
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
  oldAmount: number;
  newAmount: number;
  currency: string;
  appliedAt: string;
}
