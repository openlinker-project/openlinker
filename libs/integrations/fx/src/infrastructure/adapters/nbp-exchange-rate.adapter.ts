/**
 * NBP Exchange Rate Adapter
 *
 * Narodowy Bank Polski table A (average rates - the statutory PL reference).
 * Public and unauthenticated; volume is at most one request per currency per
 * day because the shared registry absorbs everything else.
 *
 * THIS ADAPTER OWNS THE POLISH WORKING-DAY CALENDAR. `resolveRateDate` hands it
 * a CALENDAR candidate day, and NBP publishes only on Polish business days, so
 * the adapter resolves the candidate to the nearest working day AT OR BEFORE it
 * before making any request. "At or before", not "strictly before": a candidate
 * that is itself a working day resolves to ITSELF. Calling `previousWorkingDay`
 * unconditionally would skip a perfectly good publication day and stamp
 * yesterday's rate on a financial figure, silently, with no error anywhere.
 *
 * The HTTP walk-back that follows is defence in depth, not the primary
 * mechanism: it exists for a day the calendar thinks is a working day but NBP
 * did not publish on.
 *
 * DIRECTION: NBP quotes `X -> PLN` only. So `X -> PLN` is direct, `PLN -> X`
 * is a single inversion, and `X -> Y` pivots through PLN.
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
import { isPlWorkingDay, previousWorkingDay } from '@openlinker/shared/date';
import type { FetchLike } from '@openlinker/shared/http';
import { Logger } from '@openlinker/shared/logging';
import {
  FxTransportError,
  fxGet,
  isTransientFxStatus,
  FX_DEFAULT_TIMEOUT_MS,
} from '../http/fx-http.client';
import { directRate, invertedRate, pivotRate } from './rate-arithmetic';

const NBP_BASE_URL = 'https://api.nbp.pl/api/exchangerates/rates/a';

/** The currency every table-A quote is expressed in. */
const NBP_PIVOT_CURRENCY = 'PLN';

/**
 * How many publication days the 404 walk-back will TRY before giving up - the
 * first candidate plus seven steps back.
 *
 * Named for attempts rather than days on purpose (#2135 review, finding 5): the
 * loop is `attempt < NBP_MAX_WALK_BACK_ATTEMPTS`, so the count here is exactly
 * the number of requests made per leg and matches what the spec asserts
 * (`<= 8`). The previous `_DAYS = 7` with a `<=` bound described one fewer
 * request than it made.
 *
 * Eight covers any realistic Polish holiday cluster once the calendar has
 * already skipped weekends and known holidays. It is a bound on a defensive
 * path, not the mechanism - a pair that is simply absent from table A is
 * rejected by `supports()` before a single request is made, which is what stops
 * an unsupported pair costing `maxAttempts` (10) x 8 futile requests.
 */
const NBP_MAX_WALK_BACK_ATTEMPTS = 8;

/**
 * NBP table A. Tables B (weekly exotics) and C (bid/ask) are deliberately out
 * of scope, so a currency absent here is permanently unreachable through this
 * adapter - which is exactly what `supports()` needs to be able to say up front.
 *
 * `PLN` HEADS THE LIST AND IS NOT A TABLE-A ROW. Table A quotes everything
 * AGAINST PLN, so there is no `.../a/pln/` series to fetch and never will be.
 * It is listed because this array is what both `supports()` and
 * `listSupportedCurrencies()` answer from: without it `supports('EUR', 'PLN')`
 * would be false - i.e. the adapter would deny the one pair it serves most
 * directly - and the reachability gate behind the reporting-currency setting
 * would be offered a currency set with no PLN in it. Deleting the entry as an
 * apparent data error breaks both, silently and at save time rather than here.
 * The ECB list carries the mirror-image note about `EUR`.
 */
const NBP_TABLE_A_CURRENCIES: readonly string[] = [
  'PLN',
  'THB',
  'USD',
  'AUD',
  'HKD',
  'CAD',
  'NZD',
  'SGD',
  'EUR',
  'HUF',
  'CHF',
  'GBP',
  'UAH',
  'JPY',
  'CZK',
  'DKK',
  'ISK',
  'NOK',
  'SEK',
  'RON',
  'BGN',
  'TRY',
  'ILS',
  'CLP',
  'PHP',
  'MXN',
  'ZAR',
  'BRL',
  'MYR',
  'IDR',
  'INR',
  'KRW',
  'CNY',
  'XDR',
];

/** One table-A quote as NBP publishes it. */
interface NbpQuote {
  readonly currency: string;
  readonly mid: number;
  readonly effectiveDate: string;
  readonly tableNumber: string | null;
}

export interface NbpExchangeRateAdapterDeps {
  readonly fetchImpl: FetchLike;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
}

export class NbpExchangeRateAdapter implements ExchangeRateProviderPort {
  readonly name: ExchangeRateSource = 'nbp';
  readonly pivotCurrency: string | null = NBP_PIVOT_CURRENCY;

  private readonly logger = new Logger(NbpExchangeRateAdapter.name);
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(deps: NbpExchangeRateAdapterDeps) {
    this.fetchImpl = deps.fetchImpl;
    this.timeoutMs = deps.timeoutMs ?? FX_DEFAULT_TIMEOUT_MS;
    this.baseUrl = deps.baseUrl ?? NBP_BASE_URL;
  }

  supports(from: string, to: string): boolean {
    // A same-currency pair is not supported by ANY provider - no source
    // publishes an identity quote, and the stamp short-circuits before it
    // would ever ask for one.
    if (from === to) {
      return false;
    }
    return NBP_TABLE_A_CURRENCIES.includes(from) && NBP_TABLE_A_CURRENCIES.includes(to);
  }

  listSupportedCurrencies(): readonly string[] {
    return NBP_TABLE_A_CURRENCIES;
  }

  async fetchRate(input: FetchRateInput): Promise<ExchangeRate> {
    const { from, to, on } = input;

    if (!this.supports(from, to)) {
      throw new RateUnsupportedPairError(
        this.name,
        from,
        to,
        on,
        'the pair is not published in NBP table A'
      );
    }

    // Which table-A rows this pair needs. Both legs are fetched for the SAME
    // day, so a pivot can never combine two different effective dates.
    const legCurrencies =
      to === NBP_PIVOT_CURRENCY ? [from] : from === NBP_PIVOT_CURRENCY ? [to] : [from, to];

    const quotes = await this.fetchQuotesForNearestPublishedDay(legCurrencies, on, from, to);
    const effectiveDate = this.singleEffectiveDate(quotes, from, to, on);
    const legs = quotes.map((quote) => this.toLeg(quote));

    if (to === NBP_PIVOT_CURRENCY) {
      return this.build(from, to, effectiveDate, directRate(quotes[0].mid), 'direct', null, legs);
    }

    if (from === NBP_PIVOT_CURRENCY) {
      return this.build(from, to, effectiveDate, invertedRate(quotes[0].mid), 'inverted', null, legs);
    }

    // rate(from -> to) = mid(from -> PLN) / mid(to -> PLN)
    return this.build(
      from,
      to,
      effectiveDate,
      pivotRate(quotes[0].mid, quotes[1].mid),
      'pivot',
      NBP_PIVOT_CURRENCY,
      legs
    );
  }

  /**
   * Implements `ExchangeRateProviderPort.resolveExpectedPublicationDay`
   * (#2777). Delegates to the same working-day-calendar primitive
   * `fetchQuotesForNearestPublishedDay` already uses for the HTTP
   * walk-back - no second copy of the Polish working-day calendar.
   */
  resolveExpectedPublicationDay(candidate: string): string {
    return this.resolveWorkingDayAtOrBefore(candidate);
  }

  /**
   * Resolve the calendar candidate onto a day NBP actually published on, and
   * return every requested currency's quote for that one day.
   *
   * `from` / `to` are the pair the CALLER asked for and are threaded down
   * purely so every error names it. A leg currency is not that pair: a
   * `PLN -> EUR` request fetches the single `EUR` leg, so reporting the leg
   * would render an exhausted walk-back as `EUR/EUR` - a pair the operator
   * never asked for, on a terminal `business_failure` whose log line is the
   * only signal they get. The leg and the day stay in the `reason` string,
   * where they are diagnostic detail rather than the subject.
   */
  private async fetchQuotesForNearestPublishedDay(
    currencies: readonly string[],
    candidate: string,
    from: string,
    to: string
  ): Promise<readonly NbpQuote[]> {
    let day = this.resolveWorkingDayAtOrBefore(candidate);

    for (let attempt = 0; attempt < NBP_MAX_WALK_BACK_ATTEMPTS; attempt += 1) {
      const quotes = await this.tryFetchQuotesFor(currencies, day, candidate, from, to);
      if (quotes) {
        return quotes;
      }
      this.logger.debug(
        `NBP published no table A for ${day}; walking back ` +
          `(attempt ${attempt + 1}/${NBP_MAX_WALK_BACK_ATTEMPTS})`
      );
      day = this.previousWorkingDayIso(day);
    }

    throw new RateUnsupportedPairError(
      this.name,
      from,
      to,
      candidate,
      `no NBP table A publication found within ${NBP_MAX_WALK_BACK_ATTEMPTS} working days of ${candidate}`
    );
  }

  /** `null` when NBP answered 404 for any leg - i.e. it did not publish that day. */
  private async tryFetchQuotesFor(
    currencies: readonly string[],
    day: string,
    candidate: string,
    from: string,
    to: string
  ): Promise<readonly NbpQuote[] | null> {
    const quotes: NbpQuote[] = [];

    for (const currency of currencies) {
      const quote = await this.fetchQuote(currency, day, candidate, from, to);
      if (quote === null) {
        return null;
      }
      quotes.push(quote);
    }

    return quotes;
  }

  private async fetchQuote(
    currency: string,
    day: string,
    candidate: string,
    from: string,
    to: string
  ): Promise<NbpQuote | null> {
    const url = `${this.baseUrl}/${currency.toLowerCase()}/${day}/?format=json`;

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
      // NBP does NOT return an empty result for a non-publication day - it
      // 404s. That is the walk-back signal, and it is the opposite of ECB's
      // zero-byte 200.
      return null;
    }

    if (isTransientFxStatus(response.status)) {
      // `>= 500` PLUS 429/408 (`isTransientFxStatus`). NBP is public and
      // unauthenticated, so 429 is exactly what a burst earns - and the sweep's
      // sequential page walk can produce one unaided. Classifying it terminal
      // would write the row's permanent `fxStampedAt` marker and cost those
      // orders their reported figure for a throttle that clears in seconds
      // (#2135 review, finding 1).
      throw new RateUnavailableTransientError(
        this.name,
        from,
        to,
        candidate,
        `NBP responded ${response.status} for ${currency} on ${day}`
      );
    }

    if (response.status >= 400) {
      // Every REMAINING non-404 4xx is terminal, deliberately, rather than
      // hardcoding 400. NBP is documented to answer 400 for a date it cannot
      // parse or that lies outside the published range, but that is not
      // verified against the live API - so treating the rest of the class as
      // terminal is correct whichever code it actually returns, and closes the
      // hole where a 400 would escape a 404-only walk-back as an unhandled
      // HTTP error. The two unambiguously-transient codes are excluded above
      // precisely BECAUSE the class is unverified.
      throw new RateUnsupportedPairError(
        this.name,
        from,
        to,
        candidate,
        `NBP responded ${response.status} for ${currency} on ${day}`
      );
    }

    return this.parseQuote(response.body, currency, day, candidate, from, to);
  }

  private parseQuote(
    body: string,
    currency: string,
    day: string,
    candidate: string,
    from: string,
    to: string
  ): NbpQuote | null {
    const fail = (reason: string): never => {
      throw new RateUnsupportedPairError(
        this.name,
        from,
        to,
        candidate,
        `${reason} (${currency} on ${day})`
      );
    };

    if (body.trim().length === 0) {
      return fail('NBP returned an empty body');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return fail('NBP returned a body that is not JSON');
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return fail('NBP returned a non-object body');
    }

    const rates = (parsed as { rates?: unknown }).rates;
    if (!Array.isArray(rates) || rates.length === 0) {
      return fail('NBP returned no rates array');
    }

    const row = rates[0] as { no?: unknown; effectiveDate?: unknown; mid?: unknown };
    const mid = typeof row.mid === 'number' ? row.mid : Number(row.mid);
    if (!Number.isFinite(mid) || mid <= 0) {
      return fail('NBP returned a non-numeric mid');
    }

    const effectiveDate =
      typeof row.effectiveDate === 'string' && row.effectiveDate.length > 0
        ? row.effectiveDate
        : day;

    return {
      currency,
      mid,
      effectiveDate,
      tableNumber: typeof row.no === 'string' ? row.no : null,
    };
  }

  /**
   * A pivot whose legs resolve to DIFFERENT effective dates raises rather than
   * silently picking one: combining two dates into a single `rateDate` would
   * make the stored row unverifiable against any published table.
   */
  private singleEffectiveDate(
    quotes: readonly NbpQuote[],
    from: string,
    to: string,
    candidate: string
  ): string {
    const dates = Array.from(new Set(quotes.map((quote) => quote.effectiveDate)));
    if (dates.length !== 1) {
      throw new RateUnsupportedPairError(
        this.name,
        from,
        to,
        candidate,
        `pivot legs resolved to different effective dates: [${dates.join(', ')}]`
      );
    }
    return dates[0];
  }

  private toLeg(quote: NbpQuote): RateDerivationLeg {
    return {
      pair: `${quote.currency}/${NBP_PIVOT_CURRENCY}`,
      ref: quote.tableNumber,
      effectiveDate: quote.effectiveDate,
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
    const refs = Array.from(
      new Set(legs.map((leg) => leg.ref).filter((ref): ref is string => ref !== null))
    );

    return {
      source: this.name,
      from,
      to,
      rateDate,
      rate,
      // Both legs of a same-day pivot come off the same table, so the refs
      // normally collapse to one. Joined rather than dropped when they do not,
      // because the column is the operator's shortest route back to the source
      // document.
      sourceRef: refs.length === 0 ? null : refs.join(' + '),
      pivotCurrency: pivot,
      derivation: { kind, legs },
    };
  }

  /**
   * The nearest Polish working day AT OR BEFORE `isoDay`.
   *
   * `previousWorkingDay` always steps back at least one calendar day - correct
   * for its own contract, wrong as a blind call here, because a candidate that
   * is already a working day must resolve to itself.
   */
  private resolveWorkingDayAtOrBefore(isoDay: string): string {
    const instant = isoDayToInstant(isoDay);
    return isPlWorkingDay(instant) ? isoDay : instantToIsoDay(previousWorkingDay(instant));
  }

  private previousWorkingDayIso(isoDay: string): string {
    return instantToIsoDay(previousWorkingDay(isoDayToInstant(isoDay)));
  }
}

/**
 * Midday UTC, deliberately: the working-day helpers classify at the
 * Europe/Warsaw civil calendar, and anchoring at midnight would put a
 * UTC+1/UTC+2 shift on the wrong side of the day boundary.
 */
function isoDayToInstant(isoDay: string): Date {
  const [year, month, day] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/**
 * Module scope, matching `rate-date-resolution.ts`: constructing an
 * `Intl.DateTimeFormat` is the expensive part, and the walk-back calls this
 * once per step. `en-CA` renders `YYYY-MM-DD`.
 */
const warsawDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function instantToIsoDay(instant: Date): string {
  return warsawDayFormatter.format(instant);
}
