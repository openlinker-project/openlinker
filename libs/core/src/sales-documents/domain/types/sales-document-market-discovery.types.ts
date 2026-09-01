/**
 * Sales-Document Market Discovery Types (#2518, ADR-066)
 *
 * A clean OpenLinker instance has no sales-document routing, and should not:
 * which document a sale needs is a legal question about the seller's business.
 * The consequence today is silence - orders arrive, no document is issued, and
 * nothing says which markets need a decision.
 *
 * OpenLinker already knows where every order is routed, so the set of markets
 * needing a decision is derivable. This is the shape of that derivation: one
 * row per country orders arrived from over a window, with the count that makes
 * an operator act. "Not configured" alone does not.
 *
 * Three properties are load-bearing:
 *
 * 1. **It is a READ.** Discovery never creates a rule, a country default or
 *    any routing on its own. Issuing a fiscal document nobody chose is a legal
 *    act taken on the operator's behalf, which ADR-041 forbids.
 * 2. **Classification is the caller's job.** A country with configured routing
 *    and one without are BOTH returned. This type carries no `configured` flag
 *    and no `hasTemplate` flag - the settings page joins these rows against
 *    `listConfiguredCountries` and against the curated templates itself. Two
 *    sources of truth for "is this market set up" is exactly the drift the
 *    routing-first redesign exists to remove.
 * 3. **A detected, unconfigured market is NEUTRAL, not a fault.** Nothing here
 *    is named `missing`, `unconfigured` or `problem`, because a fresh install
 *    is not broken - nobody has made a decision yet, and rendering that as an
 *    error tells a new operator their instance is misconfigured on day one.
 *
 * These types live in `sales-documents` beside `SalesDocumentCountrySummary`,
 * its configured-side counterpart, rather than in `orders` where the read is
 * executed: the vocabulary belongs to the concern that asks the question. The
 * concern keeps its zero-outbound-core-context-edge property - this file
 * imports nothing.
 *
 * @module libs/core/src/sales-documents/domain/types
 * @see docs/architecture/adrs/066-sales-document-market-discovery.md
 */

/**
 * How far back discovery looks, in days.
 *
 * A documented constant rather than a per-operator setting, per ADR-066: a
 * short window under-reports a seasonal market and a long one lists markets
 * the seller has left, and there is no evidence yet that one operator needs a
 * different answer from another. 30 days matches the value the committed UX
 * mockup renders beside each detected market.
 *
 * The resolved window travels on {@link SalesDocumentMarketDiscovery} rather
 * than being read from here by a surface, so the copy can say "in the last 30
 * days" without a frontend copy of this number that could drift from it.
 */
export const SALES_DOCUMENT_MARKET_DISCOVERY_WINDOW_DAYS = 30;

/** One country orders arrived from over the window. */
export interface DetectedSalesDocumentMarket {
  /**
   * ISO 3166-1 alpha-2 as the order carried it, verbatim.
   *
   * Never normalised, mapped to a display name, or matched case-insensitively
   * here: the value has to be comparable with what a rule was authored
   * against, and a surface that silently folded `pl` into `PL` would report a
   * market whose rules the evaluator will never match.
   */
  readonly country: string;
  /** Orders from that country within the window. Always at least 1 - a zero row cannot exist. */
  readonly orderCount: number;
}

/**
 * The discovery read's full answer, window included.
 */
export interface SalesDocumentMarketDiscovery {
  /** The window actually applied, so a surface never hardcodes it. */
  readonly windowDays: number;
  /** ISO-8601 lower bound the counts were taken from, inclusive. */
  readonly since: string;
  /**
   * Detected markets, most orders first. Empty on an instance that has
   * ingested no orders in the window at all - which is a legitimate state (a
   * brand-new install), not an error.
   */
  readonly markets: readonly DetectedSalesDocumentMarket[];
}
