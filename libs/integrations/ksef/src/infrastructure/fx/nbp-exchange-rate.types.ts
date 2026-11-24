/**
 * NBP Exchange-Rate Client Types
 *
 * Neutral (FA(3)-agnostic) contract for resolving the National Bank of Poland
 * (NBP) average exchange rate used to satisfy art. 106e ust. 11 ustawy o VAT:
 * a foreign-currency invoice must additionally express the VAT amount in PLN,
 * converted at the NBP table-A average rate for the last business day PRECEDING
 * the tax point. PL/KSeF specifics stay in this package (ADR-026) — no NBP/PLN
 * vocabulary ever crosses back into `libs/core`.
 *
 * The `fetch` implementation is injectable so specs never touch the network.
 *
 * @module libs/integrations/ksef/src/infrastructure/fx
 */

/** NBP public rates base URL; the table letter follows it (public JSON endpoint, no SDK / npm dep). */
export const NBP_RATES_BASE = 'https://api.nbp.pl/api/exchangerates/rates';

/**
 * Width of the table-A date range read in ONE request, ending the day before
 * the tax point. NBP returns only publication days inside a range, so the last
 * row is the last business day preceding the tax point - weekends and holidays
 * need no calendar. 14 days clears the longest Polish holiday cluster (the
 * Christmas / New-Year window) with room to spare. One range request replaces
 * the former day-by-day walk-back, which could take ten requests and stretch
 * the issuance round-trip past the fiscal lease (DEF-04).
 */
export const NBP_MAX_LOOKBACK_DAYS = 14;

/**
 * Table B is published weekly (Wednesdays), so its window must span more than
 * one publication gap plus a holiday.
 */
export const NBP_TABLE_B_LOOKBACK_DAYS = 21;

/** Default per-request network timeout for the production fetch wrapper. */
export const NBP_REQUEST_TIMEOUT_MS = 10_000;

/**
 * A resolved NBP rate. `rateDate` is the NBP publication date actually used
 * (the walked-back business day, not the tax point), and `table` is the NBP
 * table reference (`rates[0].no`, e.g. `"047/A/NBP/2026"`) for audit.
 */
export interface NbpResolvedRate {
  /** PLN per 1 unit of the foreign currency (NBP `mid`, > 0). */
  rate: number;
  /** Publication date of the rate used, ISO `YYYY-MM-DD`. */
  rateDate: string;
  /** NBP table reference (`rates[0].no`). */
  table: string;
}

/**
 * Minimal `fetch` surface the client depends on — a subset of the DOM/undici
 * `Response`, so the global `fetch` satisfies it directly and a test fake is a
 * one-liner. Kept intentionally narrow (no headers/body) to keep fakes trivial.
 */
export interface NbpFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Injectable `fetch` shape. Production wires the global `fetch`; specs a fake. */
export type NbpFetch = (url: string) => Promise<NbpFetchResponse>;

/**
 * Resolver contract consumed by the KSeF invoicing adapter. Implemented by
 * {@link NbpExchangeRateClient}; the adapter depends on this interface (not the
 * concrete class) so it can be faked in unit specs.
 */
export interface NbpExchangeRateResolverPort {
  /**
   * Resolve the NBP table-A average rate for `currencyCode` (ISO-4217) on the
   * last publication day on-or-before `(taxPointDate − 1 day)` — i.e. the last
   * business day PRECEDING the tax point, per art. 106e ust. 11.
   *
   * @param currencyCode ISO-4217 code (case-insensitive), e.g. `"EUR"`.
   * @param taxPointDate ISO `YYYY-MM-DD` — the tax point (moment obowiązku
   *   podatkowego); the search starts the day before it.
   * @throws {KsefExchangeRateException} on a network failure, a non-404 HTTP
   *   error, a malformed response, or when no rate is published within the
   *   look-back window.
   */
  resolveRate(currencyCode: string, taxPointDate: string): Promise<NbpResolvedRate>;
}
