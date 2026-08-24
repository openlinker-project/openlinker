/**
 * Tax-Rate Journal Types (#2250, ADR-063 § 4)
 *
 * A mutable "rate source" field only says how things stand now. It cannot
 * answer *when* the shop changed the rate, *what* OpenLinker last wrote onto a
 * channel, or *whether somebody overwrote it afterwards* - and that last
 * question is what makes a shop-versus-channel disagreement attributable
 * rather than mysterious.
 *
 * So the provenance is a journal: one row per **change**, never per read. An
 * identical repeat writes nothing, which is what keeps a table fed by an
 * every-20-minute catalogue sweep from growing without bound.
 *
 * @module libs/core/src/products/domain/types
 */

/**
 * Where an observed rate came from.
 *
 * The three are not interchangeable, and the third is the reason the journal
 * exists at all: `written-by-us` records OpenLinker's own write onto a channel,
 * so a later `channel` observation carrying a different value proves somebody
 * changed it after we did.
 */
export const TaxRateJournalOriginValues = [
  /** Read from the ProductMaster - the shop's own catalogue. */
  'shop',
  /** Read back from a sales channel (a marketplace offer or order line). */
  'channel',
  /** Written BY OpenLinker onto a channel. Not an observation - an action. */
  'written-by-us',
] as const;
export type TaxRateJournalOrigin = (typeof TaxRateJournalOriginValues)[number];

/** One observation, as a caller reports it. */
export interface TaxRateObservation {
  /** Internal product id. Always present - the journal is product-scoped. */
  productId: string;
  /** Internal variant id when the observation is variant-specific. */
  variantId: string | null;
  /**
   * The connection the observation is about: the master connection for a
   * `shop` read, the marketplace connection for the other two. Never null -
   * an observation with no connection has no channel to be attributed to.
   */
  connectionId: string;
  origin: TaxRateJournalOrigin;
  /** The neutral rate code observed, or `null` when the source named none. */
  taxRate: string | null;
  /**
   * The channel reports this field as frozen by the seller.
   *
   * Recorded because it changes what a disagreement MEANS: a frozen value is
   * one a person set deliberately (Erli sets `frozen.taxRate` when the seller
   * edits it in their panel), so the surface can say so instead of implying
   * OpenLinker failed to write. Absent on a `shop` observation, which has no
   * such concept.
   */
  frozen?: boolean;
  /** When the observation was made. Defaults to now at the write site. */
  observedAt?: Date;
}

/** One persisted journal row. */
export interface TaxRateJournalEntry extends TaxRateObservation {
  id: string;
  observedAt: Date;
  createdAt: Date;
}

/**
 * Whether an observation differs from what the journal last holds for the same
 * item and connection.
 *
 * Pure, so the dedup rule has one definition rather than one per call site.
 * The comparison covers the value, the origin AND the frozen flag: a seller
 * freezing a field without changing its value is a real change in what the
 * value means, and losing it would leave the disagreement surface unable to
 * say a person set it.
 */
export function isNewTaxRateObservation(
  latest: TaxRateJournalEntry | null,
  observation: TaxRateObservation
): boolean {
  if (latest === null) return true;
  return (
    latest.taxRate !== observation.taxRate ||
    latest.origin !== observation.origin ||
    (latest.frozen ?? false) !== (observation.frozen ?? false)
  );
}
