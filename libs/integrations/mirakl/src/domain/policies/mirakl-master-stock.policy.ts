/**
 * Mirakl Master Stock Policy
 *
 * Rules for writing stock when Mirakl is the inventory master (#4284).
 *
 * STO01 takes an ABSOLUTE quantity and applies it asynchronously (about five
 * seconds on Empik staging), while OpenLinker asks for a DELTA. So every
 * adjustment reads the current quantity and writes `current + delta`. Between
 * the submit and Mirakl applying it, OF21 still answers the old number; a
 * second adjustment reading it then would write over the first one. The last
 * submitted target is therefore remembered and read in place of OF21 for a
 * short window.
 *
 * The window is short on purpose: past it, OF21 wins, because it is the only
 * place a sale made on the marketplace itself shows up, and trusting our own
 * number for longer would write over that sale.
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */

/** How long a submitted target stands in for OF21 (STO01 applies in seconds). */
export const MIRAKL_PENDING_STOCK_TRUST_MS = 2 * 60_000;

/** A stock target OpenLinker submitted and Mirakl may not have applied yet. */
export interface MiraklPendingStock {
  readonly target: number;
  readonly importId: string;
  /** ISO instant of the submit. */
  readonly submittedAt: string;
}

/**
 * The quantity to treat as current: the pending target while it is fresh and
 * OF21 has not caught up, OF21 otherwise.
 */
export function resolveMiraklCurrentStock(
  observed: number,
  pending: MiraklPendingStock | null,
  now: Date
): number {
  if (!pending) {
    return observed;
  }
  const age = now.getTime() - Date.parse(pending.submittedAt);
  if (!Number.isFinite(age) || age < 0 || age > MIRAKL_PENDING_STOCK_TRUST_MS) {
    return observed;
  }
  return pending.target;
}

/** The quantity to write: never below zero, never fractional. */
export function computeMiraklStockTarget(
  current: number,
  delta: number
): { readonly target: number; readonly clamped: boolean } {
  const raw = Math.floor(current + delta);
  return raw < 0 ? { target: 0, clamped: true } : { target: raw, clamped: false };
}

/** A quantity as OF21 reports it, read defensively: a missing value is zero. */
export function readMiraklOfferQuantity(quantity: number | undefined): number {
  return typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0
    ? Math.floor(quantity)
    : 0;
}
