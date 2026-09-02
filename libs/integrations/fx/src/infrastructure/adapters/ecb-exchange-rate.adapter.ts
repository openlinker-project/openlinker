/**
 * ECB Exchange Rate Adapter
 *
 * European Central Bank daily reference rates, read from the SDMX data API at
 * `data-api.ecb.europa.eu`. Public and unauthenticated. (The legacy
 * `sdw-wsrest.ecb.europa.eu` host most third-party documentation cites no
 * longer resolves at all, so any example written against it is dead.)
 *
 * NO WALK-BACK LOOP, AND THAT IS THE POINT. `endPeriod={candidate}` plus
 * `lastNObservations=1` makes the API itself answer "the last publication on
 * or before this date" - one request, no calendar knowledge in the adapter, and
 * correct across clusters a walk-back-by-one gets wrong (Good Friday and Easter
 * Monday 2026 both resolve to 2026-04-02; 2026-01-01 resolves to 2025-12-31
 * across the year boundary). The returned `TIME_PERIOD` is the ACTUAL rate date
 * and is what gets persisted, exactly as the NBP adapter persists NBP's own
 * `effectiveDate`.
 *
 * The response shapes are NOT the NBP shapes, and reading them as if they were
 * is the trap this adapter is written around:
 *
 *  - A non-publication day is `200` WITH A ZERO-BYTE BODY, not a 404. An
 *    adapter written on the NBP shape would treat it as success-with-no-data
 *    and hand an empty string to its parser. The body is length-checked BEFORE
 *    any parsing, in every format - the empty response is zero bytes in
 *    `jsondata` and SDMX-ML too, so a JSON or XML parser would throw on empty
 *    input rather than yield an empty document.
 *  - A `404` (RFC-7807 JSON body) means the SERIES does not exist - an
 *    unsupported currency. Distinct signal, distinct reason, both terminal.
 *  - A `400` returns a ~12 KB HTML page, not JSON, while `404` and `406` return
 *    `application/problem+json`. So a 4xx body is never `JSON.parse`d here.
 *  - `406` is an unsupported `Accept` header - our bug, terminal, never retried.
 *  - A FUTURE `endPeriod` silently returns a stale rate with HTTP 200 and no
 *    signal of any kind (a 2026-12-24 query answered 2026-08-13). That is what
 *    makes `resolveRateDate`'s today-in-Warsaw clamp load-bearing, and it is
 *    why `MAX_OBSERVATION_LAG_DAYS` below exists as a cheap backstop.
 *
 * `includeHistory` is DELIBERATELY NOT SET. Combined with
 * `lastNObservations=1` it injects a phantom second row carrying
 * `ACTION=Delete`, an empty `OBS_VALUE` and an unrelated historical
 * `TIME_PERIOD` (a 2015 date observed on a 2026 query) - so an adapter reading
 * "the last row" gets an empty rate and a nonsense date. The read below is
 * guaranteed single-row without it.
 *
 * DIRECTION: ECB quotes `EUR -> X` only, the mirror image of NBP. So `EUR -> X`
 * is direct, `X -> EUR` is a single inversion, and `X -> Y` pivots through EUR.
 * There is no `EUR/EUR` identity series (it 404s), which is fine because the
 * same-currency short-circuit precedes any provider call.
 *
 * @module libs/integrations/fx/infrastructure/adapters
 */
import {
  RateUnavailableTransientError,
  RateUnsupportedPairError,
  type ExchangeRate,
  type ExchangeRateProviderPort,
  type ExchangeRateSource,
  type FetchRateInput,
  type RateDerivationKind,
  type RateDerivationLeg,
} from '@openlinker/core/currency';
import { Logger } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import {
  FxTransportError,
  fxGet,
  isTransientFxStatus,
  FX_DEFAULT_TIMEOUT_MS,
} from '../http/fx-http.client';
import { directRate, invertedRate, pivotRate } from './rate-arithmetic';

const ECB_BASE_URL = 'https://data-api.ecb.europa.eu/service/data/EXR';

/** The currency every ECB reference rate is expressed against. */
const ECB_PIVOT_CURRENCY = 'EUR';

/** Dataflow and DSD, confirmed against the live API's series metadata. */
const ECB_DATAFLOW = 'ECB:EXR(1.0)';

/**
 * The longest gap the observation may lag the requested `endPeriod` before the
 * adapter refuses it.
 *
 * The real maximum consecutive non-publication run is FOUR calendar days,
 * derived from the fixed TARGET closing set {1 Jan, Good Friday, Easter Monday,
 * 1 May, 25 Dec, 26 Dec} plus weekends, and confirmed on both the Easter 2026
 * and Christmas 2025-26 clusters; a run of five is not constructible. Ten is
 * therefore generous slack around a hard bound, which is what makes it a useful
 * assertion rather than a policy: it cannot reject a legitimate observation,
 * and it DOES catch a clamp regression that let a future `endPeriod` through
 * and got a months-stale rate back at HTTP 200.
 */
const MAX_OBSERVATION_LAG_DAYS = 10;

/**
 * Above this lag the observation is accepted but WARN-logged.
 *
 * `MAX_OBSERVATION_LAG_DAYS` is a hard assertion that cannot fire on healthy
 * data; between three days and that bound sits a band that is legal (the real
 * maximum run is four) yet also what a degrading source looks like on its way
 * to being wrong. Storing a six-day-stale rate silently is the failure this
 * threshold exists to make audible, and it is only a log line because refusing
 * a legitimate Easter-cluster rate would be strictly worse (#2135 review,
 * finding 6).
 */
const OBSERVATION_LAG_WARN_DAYS = 3;

/**
 * The daily reference currencies. `EUR` is included because it is the base of
 * every series and therefore a legitimate side of every pair this adapter
 * serves (`supports` still rejects `EUR/EUR` - there is no identity series).
 */
const ECB_REFERENCE_CURRENCIES: readonly string[] = [
  'EUR',
  'USD',
  'JPY',
  'BGN',
  'CZK',
  'DKK',
  'GBP',
  'HUF',
  'PLN',
  'RON',
  'SEK',
  'CHF',
  'ISK',
  'NOK',
  'TRY',
  'AUD',
  'BRL',
  'CAD',
  'CNY',
  'HKD',
  'IDR',
  'ILS',
  'INR',
  'KRW',
  'MXN',
  'MYR',
  'NZD',
  'PHP',
  'SGD',
  'THB',
  'ZAR',
];

/** One resolved observation from a single series. */
interface EcbObservation {
  /** The non-EUR side of the series, e.g. `PLN` for `D.PLN.EUR.SP00.A`. */
  readonly currency: string;
  /** Units of `currency` per one EUR. */
  readonly value: number;
  /** The day ECB actually published for, ISO `YYYY-MM-DD`. */
  readonly timePeriod: string;
  /** The OL-constructed, re-executable locator - see `buildSourceRef`. */
  readonly ref: string;
}

export interface EcbExchangeRateAdapterDeps {
  readonly fetchImpl: FetchLike;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
}

export class EcbExchangeRateAdapter implements ExchangeRateProviderPort {
  readonly name: ExchangeRateSource = 'ecb';
  readonly pivotCurrency: string | null = ECB_PIVOT_CURRENCY;

  private readonly logger = new Logger(EcbExchangeRateAdapter.name);
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(deps: EcbExchangeRateAdapterDeps) {
    this.fetchImpl = deps.fetchImpl;
    this.timeoutMs = deps.timeoutMs ?? FX_DEFAULT_TIMEOUT_MS;
    this.baseUrl = deps.baseUrl ?? ECB_BASE_URL;
  }

  supports(from: string, to: string): boolean {
    if (from === to) {
      return false;
    }
    return ECB_REFERENCE_CURRENCIES.includes(from) && ECB_REFERENCE_CURRENCIES.includes(to);
  }

  listSupportedCurrencies(): readonly string[] {
    return ECB_REFERENCE_CURRENCIES;
  }

  async fetchRate(input: FetchRateInput): Promise<ExchangeRate> {
    const { from, to, on } = input;

    if (!this.supports(from, to)) {
      throw new RateUnsupportedPairError(
        this.name,
        from,
        to,
        on,
        'the pair is not in the ECB daily reference set'
      );
    }

    if (from === ECB_PIVOT_CURRENCY) {
      // EUR -> X: the published series, read as-is.
      const observation = await this.fetchObservation(to, on, from, to);
      return this.build(from, to, observation.timePeriod, directRate(observation.value), 'direct', null, [
        this.toLeg(observation),
      ]);
    }

    if (to === ECB_PIVOT_CURRENCY) {
      // X -> EUR: the series is EUR -> X, so a single inversion.
      const observation = await this.fetchObservation(from, on, from, to);
      return this.build(
        from,
        to,
        observation.timePeriod,
        invertedRate(observation.value),
        'inverted',
        null,
        [this.toLeg(observation)]
      );
    }

    // X -> Y: both series are quoted per EUR, so
    // rate(from -> to) = mid(EUR -> to) / mid(EUR -> from).
    //
    // `allSettled`, NOT `all`: with `all` the rejection that wins is whichever
    // settles FIRST, so a pair whose one leg 404s (terminal) while the other
    // 503s (transient) classifies by network timing. That decides whether the
    // job retries ten times or dies at once, so it cannot be a race - the
    // precedence below is fixed and terminal wins.
    const settled = await Promise.allSettled([
      this.fetchObservation(from, on, from, to),
      this.fetchObservation(to, on, from, to),
    ]);

    const failure = pickLegFailure(settled);
    if (failure !== null) {
      throw failure;
    }

    const [fromObservation, toObservation] = settled.map(
      (result) => (result as PromiseFulfilledResult<EcbObservation>).value
    );

    if (fromObservation.timePeriod !== toObservation.timePeriod) {
      // Raise rather than silently picking one: combining two dates into a
      // single `rateDate` would make the stored row unverifiable against any
      // published observation.
      throw new RateUnsupportedPairError(
        this.name,
        from,
        to,
        on,
        `pivot legs resolved to different observation dates: ` +
          `[${fromObservation.timePeriod}, ${toObservation.timePeriod}]`
      );
    }

    return this.build(
      from,
      to,
      fromObservation.timePeriod,
      pivotRate(toObservation.value, fromObservation.value),
      'pivot',
      ECB_PIVOT_CURRENCY,
      [this.toLeg(fromObservation), this.toLeg(toObservation)]
    );
  }

  /**
   * Implements `ExchangeRateProviderPort.resolveLikelyPublicationDay`
   * (#2777). WEEKEND-ONLY, and that is deliberate: ECB publishes on
   * Polish-only holidays (verified divergence - Corpus Christi
   * 2026-06-04: a Polish-calendar walk-back skips it and resolves a
   * stale 4.2383 where ECB's actual last publication before Friday
   * 2026-06-05 is 4.2368, per this adapter's own header note and
   * ADR-040 § Currency). Reusing `isPlWorkingDay` here would therefore
   * silently reintroduce that exact bug. Only Sat/Sun are safe to skip
   * without source-specific holiday knowledge this adapter must not
   * have - a Polish-only holiday that also happens to be a genuine ECB
   * non-publication day still falls through to the existing
   * `lastNObservations=1` walk-back inside `fetchRate` (see class header
   * "NO WALK-BACK LOOP, AND THAT IS THE POINT"), so a wrong guess here
   * degrades to a normal live fetch, never a wrong stamp.
   */
  resolveLikelyPublicationDay(candidate: string): string {
    // Midday UTC, matching this file's existing anchoring discipline -
    // anchoring at midnight would put a UTC+1/UTC+2 shift on the wrong
    // side of the day boundary.
    const instant = new Date(`${candidate}T12:00:00Z`);
    const day = instant.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (day === 0) {
      return addUtcDays(candidate, -2); // Sunday -> Friday
    }
    if (day === 6) {
      return addUtcDays(candidate, -1); // Saturday -> Friday
    }
    return candidate;
  }

  private async fetchObservation(
    currency: string,
    candidate: string,
    from: string,
    to: string
  ): Promise<EcbObservation> {
    const seriesKey = buildSeriesKey(currency);
    // `detail=dataonly` trims the response from 32 columns to 8; `csvdata` is
    // simpler than `jsondata` here and unambiguous. `includeHistory` is
    // deliberately absent - see the class header.
    const url =
      `${this.baseUrl}/${seriesKey}` +
      `?endPeriod=${encodeURIComponent(candidate)}&lastNObservations=1` +
      `&format=csvdata&detail=dataonly`;

    let response;
    try {
      response = await fxGet(this.fetchImpl, url, this.timeoutMs);
    } catch (error) {
      if (error instanceof FxTransportError) {
        throw new RateUnavailableTransientError(this.name, from, to, candidate, error.message);
      }
      throw error;
    }

    if (response.status === 404) {
      throw new RateUnsupportedPairError(
        this.name,
        from,
        to,
        candidate,
        `ECB has no series ${seriesKey}`
      );
    }

    if (isTransientFxStatus(response.status)) {
      // `>= 500` PLUS 429/408 (`isTransientFxStatus`) - same reasoning as the
      // NBP adapter: the ECB SDMX API is public and unauthenticated too, and a
      // wrongly-terminal throttle permanently marks the order answered without
      // a figure (#2135 review, finding 1).
      throw new RateUnavailableTransientError(
        this.name,
        from,
        to,
        candidate,
        `ECB responded ${response.status}`
      );
    }

    if (response.status >= 400) {
      // Terminal, and the body is never parsed: a 400 is a ~12 KB HTML page
      // while 404/406 are `application/problem+json`, so an unconditional
      // JSON.parse would replace this error with a SyntaxError.
      throw new RateUnsupportedPairError(
        this.name,
        from,
        to,
        candidate,
        `ECB responded ${response.status} for ${seriesKey}`
      );
    }

    // Checked BEFORE parsing: a non-publication day is a 200 with a zero-byte
    // body, and it is zero bytes in every format, so a parser handed the body
    // throws on empty input rather than yielding an empty document.
    if (response.body.trim().length === 0) {
      // Debug, not warn: the ECB analogue of NBP's walk-back signal. It is the
      // one branch here that reports the API working correctly about a date it
      // has nothing for, so it is traced rather than flagged.
      this.logger.debug(
        `ECB returned an empty body (no observation) for ${seriesKey} at or before ${candidate}`
      );
      throw new RateUnsupportedPairError(
        this.name,
        from,
        to,
        candidate,
        `ECB has no observation for ${seriesKey} at or before ${candidate}`
      );
    }

    const row = parseSingleObservation(response.body);
    if (row === null) {
      throw new RateUnsupportedPairError(
        this.name,
        from,
        to,
        candidate,
        `ECB returned an unreadable observation for ${seriesKey}`
      );
    }

    this.assertObservationIsPlausible(row.timePeriod, candidate, from, to, seriesKey);

    this.logger.debug(
      `ECB ${seriesKey}: observation ${row.timePeriod} = ${row.value} ` +
        `(requested at or before ${candidate})`
    );

    return {
      currency,
      value: row.value,
      timePeriod: row.timePeriod,
      ref: buildSourceRef(seriesKey, row.timePeriod),
    };
  }

  /**
   * Cheap invariant, not a policy: it can only fire on a clamp regression or a
   * genuinely dead series, since the real maximum non-publication run is four
   * days against a declared bound of ten.
   */
  private assertObservationIsPlausible(
    timePeriod: string,
    candidate: string,
    from: string,
    to: string,
    seriesKey: string
  ): void {
    if (timePeriod > candidate) {
      throw new RateUnsupportedPairError(
        this.name,
        from,
        to,
        candidate,
        `ECB returned observation ${timePeriod} for ${seriesKey}, which is after the requested ${candidate}`
      );
    }

    const lagDays = daysBetween(timePeriod, candidate);

    if (lagDays > MAX_OBSERVATION_LAG_DAYS) {
      throw new RateUnsupportedPairError(
        this.name,
        from,
        to,
        candidate,
        `ECB returned observation ${timePeriod} for ${seriesKey}, more than ` +
          `${MAX_OBSERVATION_LAG_DAYS} days before the requested ${candidate} (lag ${lagDays}d) - ` +
          `the maximum real non-publication run is 4 days, so this indicates a stale or future request date. ` +
          `This is terminal (no retry), so once the underlying date is corrected the order is re-stamped ` +
          `by the reconcile sweep rather than by the original job.`
      );
    }

    if (lagDays > OBSERVATION_LAG_WARN_DAYS) {
      // Accepted, not refused: four days is a real TARGET closing run, so the
      // rate is legitimate. Logged because the band above it is indistinguishable
      // from a source that has stopped publishing, and the alternative is
      // storing a progressively staler rate in silence.
      this.logger.warn(
        `ECB observation for ${seriesKey} is ${lagDays} days older than the requested ` +
          `${candidate} (returned ${timePeriod}); accepted, but the longest real ` +
          `non-publication run is 4 days - check whether the source is still publishing`
      );
    }
  }

  private toLeg(observation: EcbObservation): RateDerivationLeg {
    return {
      pair: `${ECB_PIVOT_CURRENCY}/${observation.currency}`,
      ref: observation.ref,
      effectiveDate: observation.timePeriod,
    };
  }

  private build(
    from: string,
    to: string,
    rateDate: string,
    rate: string,
    kind: RateDerivationKind,
    pivot: string | null,
    legs: readonly RateDerivationLeg[]
  ): ExchangeRate {
    return {
      source: this.name,
      from,
      to,
      rateDate,
      rate,
      sourceRef: legs.map((leg) => leg.ref).join(' + ') || null,
      pivotCurrency: pivot,
      derivation: { kind, legs },
    };
  }
}

/**
 * Shifts an ISO calendar day by `delta` days, anchored at midday UTC to match
 * `resolveLikelyPublicationDay`'s own anchoring discipline (#2777).
 */
function addUtcDays(isoDay: string, delta: number): string {
  const instant = new Date(`${isoDay}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + delta);
  return instant.toISOString().slice(0, 10);
}

/**
 * The one failure a two-leg pivot reports, chosen by a FIXED precedence rather
 * than by which leg happened to settle first.
 *
 * Terminal outranks transient: per ADR-007 a `RateUnsupportedPairError` is a
 * `business_failure` that ends the job, while a `RateUnavailableTransientError`
 * buys up to `maxAttempts` (10) more waves. Reporting the transient one when a
 * sibling leg is permanently unobtainable spends ten futile round-trips to
 * arrive at the same terminal answer. An unrecognised error sits between the
 * two - it is not known to be retryable, so it must not be masked by a
 * transient sibling, but a stated terminal condition is still the better
 * explanation. Ties break on leg order (`from` before `to`), so the choice is
 * reproducible.
 *
 * `null` when both legs resolved.
 */
function pickLegFailure(results: readonly PromiseSettledResult<EcbObservation>[]): unknown {
  const rank = (error: unknown): number => {
    if (error instanceof RateUnsupportedPairError) {
      return 0;
    }
    return error instanceof RateUnavailableTransientError ? 2 : 1;
  };

  let worst: { error: unknown; rank: number } | null = null;
  for (const result of results) {
    if (result.status !== 'rejected') {
      continue;
    }
    const candidate = { error: result.reason as unknown, rank: rank(result.reason) };
    if (worst === null || candidate.rank < worst.rank) {
      worst = candidate;
    }
  }

  return worst === null ? null : worst.error;
}

/** `FREQ.CURRENCY.CURRENCY_DENOM.EXR_TYPE.EXR_SUFFIX` - daily spot average. */
function buildSeriesKey(currency: string): string {
  return `D.${currency}.${ECB_PIVOT_CURRENCY}.SP00.A`;
}

/**
 * ECB assigns NO document identifier, and that is stated here rather than
 * papered over: `header.id` is a fresh random UUID per request (two
 * near-identical requests returned different UUIDs) and `Last-Modified` is not
 * data-dependent (identical for a 2026 query and a 1999 one). So the reference
 * persisted is an OPENLINKER CONSTRUCTION - a deterministic locator that
 * round-trips back into a request returning the same observation - not an
 * ECB-assigned reference. NBP's table number is a genuine one; this is not.
 */
function buildSourceRef(seriesKey: string, timePeriod: string): string {
  return `${ECB_DATAFLOW}:${seriesKey}@${timePeriod}`;
}

/**
 * Parse the single data row out of an SDMX `csvdata` response.
 *
 * Columns are indexed BY HEADER NAME, never by position: `detail=dataonly`
 * trims the column set, and positional indexing would silently read the wrong
 * column the day ECB reorders or adds one.
 */
function parseSingleObservation(body: string): { value: number; timePeriod: string } | null {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return null;
  }

  const header = splitCsvLine(lines[0]);
  const timePeriodIndex = header.indexOf('TIME_PERIOD');
  const valueIndex = header.indexOf('OBS_VALUE');
  if (timePeriodIndex === -1 || valueIndex === -1) {
    return null;
  }

  const cells = splitCsvLine(lines[1]);
  const timePeriod = cells[timePeriodIndex];
  const raw = cells[valueIndex];
  if (timePeriod === undefined || raw === undefined || raw.length === 0) {
    return null;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return { value, timePeriod };
}

/** Minimal RFC-4180 splitter - ECB quotes some metadata cells. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);

  return cells.map((cell) => cell.trim());
}

/** Whole days between two ISO `YYYY-MM-DD` values; no timezone involved. */
function daysBetween(earlier: string, later: string): number {
  const toUtc = (iso: string): number => {
    const [year, month, day] = iso.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(later) - toUtc(earlier)) / 86_400_000);
}
