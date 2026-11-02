/**
 * orderLineCostSnapshot - the per-line cost snapshot vocabulary and carry-forward rule (#3588, D27)
 *
 * A line's net unit cost is frozen at the first `ready` ingestion so a later
 * edit of the variant cost never moves an earlier margin. Pure (no I/O): the
 * repository feeds it the prior rows it read inside the write transaction.
 *
 * Costs are decimal STRINGS end to end (numeric(12,4) round-trips as text), so
 * a stored value is reused byte for byte rather than through a float.
 *
 * @module libs/core/src/orders/domain
 */

export const LineCostStateValues = ['recorded', 'not-recorded'] as const;
export type LineCostState = (typeof LineCostStateValues)[number];

/**
 * Why a line is outside margin. Types only here: the classification is derived
 * at read time, never persisted.
 */
export const MarginGapReasonValues = [
  'no-cost',
  'cost-entered-after-sale',
  'no-variant',
  'currency-mismatch',
] as const;
export type MarginGapReason = (typeof MarginGapReasonValues)[number];

/**
 * The cost columns of one line. `recorded` <=> both `unitCostNet` and
 * `unitCostCurrency` are set (mirrors the DB CHECK). `0.00` is a real cost.
 */
export interface LineCostSnapshot {
  costState: LineCostState;
  unitCostNet: string | null;
  unitCostCurrency: string | null;
}

/** What a variant offers a line at ingestion time. */
export interface LineCostCandidate {
  unitCostNet: string;
  currency: string;
}

export const NOT_RECORDED_LINE_COST: LineCostSnapshot = {
  costState: 'not-recorded',
  unitCostNet: null,
  unitCostCurrency: null,
};

export function recordedLineCost(candidate: LineCostCandidate): LineCostSnapshot {
  return {
    costState: 'recorded',
    unitCostNet: candidate.unitCostNet,
    unitCostCurrency: candidate.currency,
  };
}

/** A previously persisted line row, reduced to what the carry-forward needs. */
export interface PriorLineCostRow extends LineCostSnapshot {
  lineNumber: number;
  productId: string;
  variantId: string | null;
}

function lineCostKey(productId: string, variantId: string | null): string {
  return `${productId}|${variantId ?? ''}`;
}

/**
 * Re-ingestion replaces an order's line rows (delete-then-reinsert), so the
 * snapshot has to be carried across by identity. Key = `productId|variantId`:
 * the line position is not stable (reorder, add, remove).
 *
 * For a key seen before, the prior row with the LOWEST lineNumber wins and is
 * reused exactly as stored - a prior `not-recorded` is never upgraded to the
 * candidate and a prior `recorded` is never replaced. A key not seen before
 * keeps the draft's own (candidate-derived) cost.
 */
export function carryForwardLineCosts<T extends { productId: string; variantId: string | null; cost: LineCostSnapshot }>(
  prior: readonly PriorLineCostRow[],
  drafts: readonly T[]
): T[] {
  const byKey = new Map<string, PriorLineCostRow>();
  for (const row of prior) {
    const key = lineCostKey(row.productId, row.variantId);
    const current = byKey.get(key);
    if (!current || row.lineNumber < current.lineNumber) {
      byKey.set(key, row);
    }
  }
  return drafts.map((draft) => {
    const hit = byKey.get(lineCostKey(draft.productId, draft.variantId));
    if (!hit) {
      return draft;
    }
    return {
      ...draft,
      cost: {
        costState: hit.costState,
        unitCostNet: hit.unitCostNet,
        unitCostCurrency: hit.unitCostCurrency,
      },
    };
  });
}
