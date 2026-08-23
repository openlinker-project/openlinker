/**
 * Tax-Rate Coverage Types (#2054 / #2256, ADR-052 § 4)
 *
 * The shape of the catalogue's tax-rate read state, counted as a query rather
 * than a crawl. One named type per shape, shared by the repository port, its
 * implementation, the products service and its interface - the counts travel
 * through four layers, and four copies of the same anonymous object could drift
 * apart one layer at a time.
 *
 * The three populations are deliberately distinct rather than "has a rate" and
 * "does not". `notChecked` is *never asked* (no sync has read the product's rate
 * yet), while `missing` is *asked, and the shop carries none* - conflating them
 * is what would make day one read as a catalogue-wide outage instead of a sync
 * that has not run.
 *
 * @module libs/core/src/products/domain/types
 * @see {@link StoredTaxRate} for the per-product read state these counts group.
 */

/** Catalogue-wide counts by tax-rate read state. */
export interface TaxRateCoverage {
  /** Products counted, whatever their read state. */
  total: number;
  /** Asked, and the shop carries a rate. */
  known: number;
  /** Asked, and the shop carries no rate - the gap an operator fixes. */
  missing: number;
  /** Never asked, so nothing is yet claimed about the product's rate. */
  notChecked: number;
}

/**
 * The same counts for one connection - the unit an operator actually fixes,
 * since "the catalogue has no rates" is not actionable when three shops feed it
 * and only one is incomplete. A product mapped on two connections is counted
 * under both.
 */
export interface ConnectionTaxRateCoverage extends TaxRateCoverage {
  connectionId: string;
  platformType: string;
}
