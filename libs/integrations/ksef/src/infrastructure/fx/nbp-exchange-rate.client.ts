/**
 * NBP Exchange-Rate Client
 *
 * Resolves the National Bank of Poland (NBP) table-A average rate for a
 * foreign currency on the last business day PRECEDING a tax point, satisfying
 * art. 106e ust. 11 ustawy o VAT (a foreign-currency invoice must additionally
 * express the VAT amount in PLN at that rate). Uses the public NBP JSON endpoint
 * (`https://api.nbp.pl/api/exchangerates/rates/a/{code}/{date}/?format=json`)
 * via native `fetch` — NO new npm dependency, mirroring the `KsefHttpClient` /
 * `AllegroHttpClient` native-fetch precedent (no axios, no SDK).
 *
 * WEEKEND / HOLIDAY WALK-BACK: NBP publishes rates only on business days and
 * returns HTTP 404 for any non-publication date. The client starts at
 * `(taxPoint − 1 day)` and walks back one day at a time until it gets a 200,
 * up to {@link NBP_MAX_LOOKBACK_DAYS}. Because NBP 404s weekends AND public
 * holidays identically, the single walk-back covers both — there is no separate
 * Polish holiday calendar (the accepted, documented MVP mechanism).
 *
 * TESTABILITY: `fetch` is injected (defaults to a timeout-wrapped global
 * `fetch`) so specs exercise the walk-back with a fake and never hit the
 * network. Time-independent: the search date is derived from the passed
 * `taxPointDate`, so no clock is needed.
 *
 * @module libs/integrations/ksef/src/infrastructure/fx
 * @implements {NbpExchangeRateResolverPort}
 */
import { Logger } from '@openlinker/shared/logging';
import { KsefExchangeRateException } from '../../domain/exceptions/ksef-exchange-rate.exception';
import {
  NBP_MAX_LOOKBACK_DAYS,
  NBP_REQUEST_TIMEOUT_MS,
  NBP_TABLE_A_BASE,
  type NbpExchangeRateResolverPort,
  type NbpFetch,
  type NbpResolvedRate,
} from './nbp-exchange-rate.types';

/** One NBP table-A rate row (subset of the documented JSON response we read). */
interface NbpRateRow {
  no?: unknown;
  effectiveDate?: unknown;
  mid?: unknown;
}

/** The NBP table-A single-currency response envelope (subset). */
interface NbpRatesResponse {
  rates?: unknown;
}

export interface NbpExchangeRateClientOptions {
  /** Injected `fetch` (specs); defaults to a timeout-wrapped global `fetch`. */
  fetchImpl?: NbpFetch;
  /** Override the walk-back window (specs); defaults to {@link NBP_MAX_LOOKBACK_DAYS}. */
  maxLookbackDays?: number;
}

export class NbpExchangeRateClient implements NbpExchangeRateResolverPort {
  private readonly logger = new Logger(NbpExchangeRateClient.name);
  private readonly fetchImpl: NbpFetch;
  private readonly maxLookbackDays: number;

  constructor(options: NbpExchangeRateClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? defaultNbpFetch;
    this.maxLookbackDays = options.maxLookbackDays ?? NBP_MAX_LOOKBACK_DAYS;
  }

  async resolveRate(currencyCode: string, taxPointDate: string): Promise<NbpResolvedRate> {
    const code = currencyCode.trim().toLowerCase();
    if (code.length === 0) {
      throw new KsefExchangeRateException('NBP rate lookup requires a non-empty currency code');
    }
    const taxPoint = parseIsoDate(taxPointDate);
    if (taxPoint === null) {
      throw new KsefExchangeRateException(
        `NBP rate lookup requires an ISO YYYY-MM-DD tax point, got "${taxPointDate}"`,
      );
    }

    // Art. 106e ust. 11: last business day PRECEDING the tax point → start the
    // day before and walk back over weekends/holidays (which NBP 404s).
    let cursor = addUtcDays(taxPoint, -1);
    for (let attempt = 0; attempt < this.maxLookbackDays; attempt++) {
      const dateStr = toIsoDate(cursor);
      const url = `${NBP_TABLE_A_BASE}/${encodeURIComponent(code)}/${dateStr}/?format=json`;

      let response;
      try {
        response = await this.fetchImpl(url);
      } catch (error) {
        throw new KsefExchangeRateException(
          `NBP rate lookup failed (network) for ${code.toUpperCase()} at ${dateStr}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (response.status === 404) {
        // Non-publication day (weekend or holiday) — step back one day.
        cursor = addUtcDays(cursor, -1);
        continue;
      }
      if (!response.ok) {
        throw new KsefExchangeRateException(
          `NBP rate lookup returned HTTP ${response.status} for ${code.toUpperCase()} at ${dateStr}`,
        );
      }

      const body = (await response.json()) as NbpRatesResponse;
      const resolved = parseNbpRate(body);
      if (resolved === null) {
        throw new KsefExchangeRateException(
          `NBP rate response for ${code.toUpperCase()} at ${dateStr} was malformed or non-positive`,
        );
      }
      this.logger.debug(
        `Resolved NBP rate for ${code.toUpperCase()}: ${resolved.rate} (table ${resolved.table}, ${resolved.rateDate})`,
      );
      return resolved;
    }

    throw new KsefExchangeRateException(
      `No NBP table-A rate published for ${code.toUpperCase()} within ${this.maxLookbackDays} ` +
        `day(s) before ${taxPointDate}`,
    );
  }
}

/** Parse the first NBP rate row into a validated {@link NbpResolvedRate} (or null). */
function parseNbpRate(body: NbpRatesResponse): NbpResolvedRate | null {
  const rows = Array.isArray(body.rates) ? (body.rates as NbpRateRow[]) : [];
  const row = rows[0];
  if (!row) {
    return null;
  }
  const rate = typeof row.mid === 'number' ? row.mid : Number(row.mid);
  const table = typeof row.no === 'string' ? row.no : '';
  const rateDate = typeof row.effectiveDate === 'string' ? row.effectiveDate : '';
  if (!Number.isFinite(rate) || rate <= 0 || table.length === 0 || rateDate.length === 0) {
    return null;
  }
  return { rate, rateDate, table };
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
 * Production `fetch` wrapper: native `fetch` with an AbortController timeout so a
 * hung NBP request never stalls issuance indefinitely. Kept module-private; the
 * client injects a fake in specs.
 */
const defaultNbpFetch: NbpFetch = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NBP_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status, json: () => response.json() };
  } finally {
    clearTimeout(timeout);
  }
};
