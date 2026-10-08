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

/** NBP table A public rates base URL (public JSON endpoint, no SDK / npm dep). */
export const NBP_TABLE_A_BASE = 'https://api.nbp.pl/api/exchangerates/rates/a';

/**
 * How many days to walk back from (tax point − 1 day) looking for a published
 * rate. NBP returns HTTP 404 on non-publication days (weekends AND public
 * holidays), so the same walk-back that skips weekends also skips holidays —
 * there is no separate holiday calendar (documented MVP mechanism). 10 days
 * comfortably clears the longest Polish holiday cluster (e.g. the Christmas /
 * New-Year window).
 */
export const NBP_MAX_LOOKBACK_DAYS = 10;

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
