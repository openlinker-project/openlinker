/**
 * Mirakl Master Stock Policy
 *
 * Rules for writing stock when Mirakl is the inventory master (#4284).
 *
 * OpenLinker adjusts by a DELTA; STO01 only takes an ABSOLUTE quantity, and
 * Mirakl accepts one STO01 file per shop roughly every 30 seconds (measured on
 * Empik staging: a second file inside the window answers 429). So an
 * adjustment is never sent on its own: it queues `current + delta` in
 * `mirakl_offer_writes`, and the offer-writes pass sends everything queued as
 * one file, the #4277 path.
 *
 * "Current" is therefore the newest queued or sent-but-unsettled target for
 * the offer when there is one, else OF21. A settled write is OF21's business
 * again: once Mirakl applied it, a sale made on the marketplace since is only
 * visible there.
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import type { MiraklOfferWriteStatus } from '../types/mirakl-offer-write.types';

/** The newest stock write for an offer, as the queue holds it. */
export interface MiraklQueuedStock {
  readonly status: MiraklOfferWriteStatus;
  readonly value: string;
}

/**
 * The quantity to treat as current: a queued or sent, not yet settled target,
 * else OF21's.
 */
export function resolveMiraklCurrentStock(
  observed: number,
  queued: MiraklQueuedStock | null
): number {
  if (!queued || (queued.status !== 'pending' && queued.status !== 'submitted')) {
    return observed;
  }
  const target = Number(queued.value);
  return Number.isInteger(target) && target >= 0 ? target : observed;
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
