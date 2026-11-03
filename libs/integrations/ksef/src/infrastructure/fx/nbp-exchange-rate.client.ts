/**
 * NBP Exchange-Rate Client
 *
 * Resolves the National Bank of Poland (NBP) average rate for a foreign
 * currency on the last business day PRECEDING a tax point, satisfying
 * art. 106e ust. 11 ustawy o VAT (a foreign-currency invoice must additionally
 * express the VAT amount in PLN at that rate). Uses the public NBP JSON range
 * endpoint (`https://api.nbp.pl/api/exchangerates/rates/{table}/{code}/{start}/{end}/?format=json`)
 * through the connection-bound transport (#1810) — NO new npm dependency,
 * mirroring the `KsefHttpClient` / `AllegroHttpClient` precedent (no axios, no SDK).
 *
 * ONE RANGE READ PER TABLE: a range answers with publication days only, so the
 * last row on or before (tax point − 1 day) is the rate the statute names, and
 * weekends and holidays need no calendar. Table A is asked first; a currency it
 * does not carry answers 404 and is asked of table B, which NBP publishes weekly
 * for the less common currencies (DEF-27). At most two requests, where the
 * former walk-back could issue ten inside one issuance round-trip (DEF-04).
 *
 * TESTABILITY: the fetch is injected and REQUIRED - production wraps the
 * connection-bound transport with {@link createNbpFetch}, specs pass a fake - so
 * a forgotten wiring cannot silently bypass the connection's rate limit.
 * Time-independent: the range is derived from the passed `taxPointDate`, so no
 * clock is needed.
 *
 * @module libs/integrations/ksef/src/infrastructure/fx
 * @implements {NbpExchangeRateResolverPort}
 */
import type { FetchLike } from '@openlinker/shared/http';
import { Logger } from '@openlinker/shared/logging';
import { KsefExchangeRateException } from '../../domain/exceptions/ksef-exchange-rate.exception';
import {
  NBP_MAX_LOOKBACK_DAYS,
  NBP_RATES_BASE,
  NBP_REQUEST_TIMEOUT_MS,
  NBP_TABLE_B_LOOKBACK_DAYS,
  type NbpExchangeRateResolverPort,
  type NbpFetch,
  type NbpResolvedRate,
} from './nbp-exchange-rate.types';

/** One NBP rate row (subset of the documented JSON response we read). */
interface NbpRateRow {
  no?: unknown;
  effectiveDate?: unknown;
  mid?: unknown;
}

/** The NBP single-currency response envelope (subset). */
interface NbpRatesResponse {
  rates?: unknown;
}

type NbpTable = 'a' | 'b';

export interface NbpExchangeRateClientOptions {
  /** The fetch to issue NBP reads with; build it with {@link createNbpFetch}. */
  fetchImpl: NbpFetch;
  /** Override the table-A range width (specs); defaults to {@link NBP_MAX_LOOKBACK_DAYS}. */
  maxLookbackDays?: number;
}

export class NbpExchangeRateClient implements NbpExchangeRateResolverPort {
  private readonly logger = new Logger(NbpExchangeRateClient.name);
  private readonly fetchImpl: NbpFetch;
  private readonly lookbackDays: Readonly<Record<NbpTable, number>>;

  constructor(options: NbpExchangeRateClientOptions) {
    this.fetchImpl = options.fetchImpl;
    const tableA = options.maxLookbackDays ?? NBP_MAX_LOOKBACK_DAYS;
    this.lookbackDays = { a: tableA, b: Math.max(tableA, NBP_TABLE_B_LOOKBACK_DAYS) };
  }

  async resolveRate(currencyCode: string, taxPointDate: string): Promise<NbpResolvedRate> {
    const code = currencyCode.trim().toLowerCase();
    if (code.length === 0) {
      throw new KsefExchangeRateException('NBP rate lookup requires a non-empty currency code', true);
    }
    const taxPoint = parseIsoDate(taxPointDate);
    if (taxPoint === null) {
      throw new KsefExchangeRateException(
        `NBP rate lookup requires an ISO YYYY-MM-DD tax point, got "${taxPointDate}"`,
        true,
      );
    }

    // Art. 106e ust. 11: last business day PRECEDING the tax point.
    const end = addUtcDays(taxPoint, -1);
    for (const table of ['a', 'b'] as const) {
      const resolved = await this.readTable(table, code, end);
      if (resolved !== null) {
        this.logger.debug(
          `Resolved NBP rate for ${code.toUpperCase()}: ${resolved.rate} (table ${resolved.table}, ${resolved.rateDate})`,
        );
        return resolved;
      }
    }

    throw new KsefExchangeRateException(
      `NBP publishes no rate for ${code.toUpperCase()} in table A or table B before ${taxPointDate}`,
      true,
    );
  }

  /**
   * Read one table over the range ending at `end`. `null` means the table has
   * nothing for this currency in the window (NBP answers 404), so the caller
   * asks the next table; every other failure throws.
   */
  private async readTable(table: NbpTable, code: string, end: Date): Promise<NbpResolvedRate | null> {
    const start = addUtcDays(end, -(this.lookbackDays[table] - 1));
    const endStr = toIsoDate(end);
    const url =
      `${NBP_RATES_BASE}/${table}/${encodeURIComponent(code)}/` +
      `${toIsoDate(start)}/${endStr}/?format=json`;
    const label = `${code.toUpperCase()} (table ${table.toUpperCase()}, up to ${endStr})`;

    let response;
    try {
      response = await this.fetchImpl(url);
    } catch (error) {
      throw new KsefExchangeRateException(
        `NBP rate lookup failed (network) for ${label}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new KsefExchangeRateException(`NBP rate lookup returned HTTP ${response.status} for ${label}`);
    }

    // A proxy or maintenance page can answer 200 with HTML (DEF-36): surface it
    // as this package's own error rather than a raw SyntaxError the core cannot
    // classify.
    let body: NbpRatesResponse;
    try {
      body = (await response.json()) as NbpRatesResponse;
    } catch {
      throw new KsefExchangeRateException(`NBP rate response for ${label} was not JSON`);
    }
    const resolved = parseLastNbpRate(body, endStr);
    if (resolved === null) {
      throw new KsefExchangeRateException(
        `NBP rate response for ${label} was malformed or non-positive`,
      );
    }
    return resolved;
  }
}

/**
 * Pick the LAST valid row dated on or before `endStr` (a range answers in date
 * order, but the order is not relied on) into a {@link NbpResolvedRate}.
 */
function parseLastNbpRate(body: NbpRatesResponse, endStr: string): NbpResolvedRate | null {
  const rows = Array.isArray(body.rates) ? (body.rates as NbpRateRow[]) : [];
  let best: NbpResolvedRate | null = null;
  for (const row of rows) {
    const rate = typeof row.mid === 'number' ? row.mid : Number(row.mid);
    const table = typeof row.no === 'string' ? row.no : '';
    const rateDate = typeof row.effectiveDate === 'string' ? row.effectiveDate : '';
    if (!Number.isFinite(rate) || rate <= 0 || table.length === 0 || rateDate.length === 0) {
      continue;
    }
    if (rateDate > endStr) {
      continue;
    }
    if (best === null || rateDate > best.rateDate) {
      best = { rate, rateDate, table };
    }
  }
  return best;
}

/** Parse a strict ISO `YYYY-MM-DD` into a UTC-midnight Date, or null. */
function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** Add `days` (may be negative) to a UTC date, returning a new Date. */
function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Render a Date's UTC calendar day as ISO `YYYY-MM-DD`. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Wrap a connection-bound transport (#1810) as an {@link NbpFetch} with an
 * AbortController timeout, so a hung NBP request never stalls issuance
 * indefinitely. The NBP read is issued on behalf of the KSeF connection it
 * serves, so it is paced by that connection's own rate limit.
 */
export function createNbpFetch(fetchImpl: FetchLike): NbpFetch {
  return async (url) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NBP_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      return { ok: response.ok, status: response.status, json: () => response.json() };
    } finally {
      clearTimeout(timeout);
    }
  };
}
