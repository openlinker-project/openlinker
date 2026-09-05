/**
 * Display Currency Conversion Service
 *
 * The read-only display-currency transform behind the `/analytics`
 * display-currency picker (#2458, ADR-064). Both modes are plain synchronous
 * application-layer code — no `SyncJobPort`, no `sync_jobs` row, no polling
 * endpoint — and neither reads nor writes `order_records.reportingCurrency` /
 * `reportingTotalAmount` (the ADR-040 write-once stamp). This is a SECOND,
 * read-only inbound edge from `orders` into the `currency` leaf context,
 * alongside the ADR-040 stamp's own edge — see
 * `docs/architecture-overview.md § 18. Currency`.
 *
 * `current-rate` groups raw native `currency`/`totalAmount` figures by
 * distinct native currency and resolves one rate per distinct currency —
 * cheap regardless of order volume, because the number of distinct native
 * currencies in any real dataset is small. `order-date` takes the
 * already-computed reporting-currency total and applies at most one rate to
 * the whole figure.
 *
 * Neither mode throws on a rate-resolution failure: a currency (or the whole
 * order-date total) that cannot be converted is reported back as an explicit
 * unresolved outcome — this backs the mockup's `unavailable` state — rather
 * than aborting the read or silently defaulting to a guessed figure.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IDisplayCurrencyConversionService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  CURRENCY_RATE_SERVICE_TOKEN,
  DEFAULT_FX_RATE_RULE,
  ICurrencyRateService,
  resolveRateDate,
  resolveRateSource,
  type StoredExchangeRate,
} from '@openlinker/core/currency';
import {
  MIXED_NATIVE_CURRENCIES_LABEL,
  type AppliedRate,
  type CurrentRateConversionInput,
  type CurrentRateConversionResult,
  type NativeCurrencyBreakdown,
  type OrderDateConversionInput,
  type OrderDateConversionResult,
} from '../../domain/types/display-currency.types';
import type { IDisplayCurrencyConversionService } from '../interfaces/display-currency-conversion.service.interface';

/**
 * Money is kept to 2 decimal places, mirroring `OrderFxStampService`'s own
 * `round2` (module-private there too — this is a display transform, not a
 * shared pricing rule, so a third copy of a two-line helper is cheaper than a
 * shared export).
 */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

interface CurrencyGroup {
  count: number;
  total: number;
}

/**
 * Group native-currency amounts by currency code, preserving input order for
 * the first-seen currency. `count` is SUMMED from each item's own `count`
 * (#2488 review, IMPORTANT 1) rather than incremented once per array entry —
 * a caller that pre-aggregates several orders into one bucket (e.g. the
 * controller's per-currency revenue bucket) reports the real order count via
 * `item.count`, not the number of buckets it happened to push.
 */
function groupByCurrency(
  amounts: readonly { readonly currency: string; readonly amount: number; readonly count: number }[]
): Map<string, CurrencyGroup> {
  const grouped = new Map<string, CurrencyGroup>();
  for (const item of amounts) {
    const existing = grouped.get(item.currency);
    if (existing) {
      existing.count += item.count;
      existing.total += item.amount;
    } else {
      grouped.set(item.currency, { count: item.count, total: item.amount });
    }
  }
  return grouped;
}

@Injectable()
export class DisplayCurrencyConversionService implements IDisplayCurrencyConversionService {
  private readonly logger = new Logger(DisplayCurrencyConversionService.name);

  constructor(
    @Inject(CURRENCY_RATE_SERVICE_TOKEN)
    private readonly rates: ICurrencyRateService
  ) {}

  async convertAtCurrentRate(
    input: CurrentRateConversionInput,
    now: Date = new Date()
  ): Promise<CurrentRateConversionResult> {
    const grouped = groupByCurrency(input.amounts);
    const rateDate = this.resolveCurrentRateDate(now);

    const breakdown: NativeCurrencyBreakdown[] = [];
    const unresolvedNativeCurrencies: string[] = [];
    let convertedTotal = 0;

    // Sequential, not `Promise.all` — mirrors `OrderFxStampService.sweep`'s
    // own reasoning: a handful of distinct currencies is a handful of
    // provider calls, and there is no latency anyone is waiting on that
    // fanning them out would improve.
    for (const [currency, group] of grouped) {
      // A bucket with no single native currency (#2488 review, IMPORTANT 2)
      // has no rate to resolve — report it as unresolved unconditionally
      // rather than spending a provider call that could only ever fail, and
      // rather than silently excluding this real money from the result with
      // no trace at all.
      if (currency === MIXED_NATIVE_CURRENCIES_LABEL) {
        unresolvedNativeCurrencies.push(currency);
        breakdown.push({
          currency,
          orderCount: group.count,
          nativeTotal: round2(group.total),
          convertedTotal: null,
          appliedRate: null,
        });
        continue;
      }

      if (currency === input.displayCurrency) {
        // An identity, not a rate — no lookup happened, so nothing produced
        // this figure beyond "it was already in the right currency" (#2778).
        const nativeTotal = round2(group.total);
        breakdown.push({
          currency,
          orderCount: group.count,
          nativeTotal,
          convertedTotal: nativeTotal,
          appliedRate: null,
        });
        convertedTotal += nativeTotal;
        continue;
      }

      const stored =
        rateDate === null
          ? null
          : await this.resolveRate(currency, input.displayCurrency, rateDate);

      if (stored === null) {
        unresolvedNativeCurrencies.push(currency);
        breakdown.push({
          currency,
          orderCount: group.count,
          nativeTotal: round2(group.total),
          convertedTotal: null,
          appliedRate: null,
        });
        continue;
      }

      const converted = round2(group.total * Number(stored.rate));
      breakdown.push({
        currency,
        orderCount: group.count,
        nativeTotal: round2(group.total),
        convertedTotal: converted,
        appliedRate: toAppliedRate(stored),
      });
      convertedTotal += converted;
    }

    return {
      displayCurrency: input.displayCurrency,
      convertedTotal: round2(convertedTotal),
      breakdown,
      unresolvedNativeCurrencies,
    };
  }

  async convertAtOrderDate(
    input: OrderDateConversionInput,
    now: Date = new Date()
  ): Promise<OrderDateConversionResult> {
    // Nothing stamped in range — there is no reporting-currency figure to
    // convert at all. Not the same as "unresolved": no conversion was even
    // attempted.
    if (input.reportingCurrency === null) {
      return {
        displayCurrency: input.displayCurrency,
        convertedTotal: null,
        sourceCurrency: null,
        unresolved: false,
        appliedRate: null,
      };
    }

    // Zero I/O — the whole point of this mode's "stable" framing. Never
    // calls `ICurrencyRateService`. An identity, not a rate (#2778) — no
    // lookup happened, so there is nothing to attribute the figure to.
    if (input.reportingCurrency === input.displayCurrency) {
      return {
        displayCurrency: input.displayCurrency,
        convertedTotal: round2(input.reportingTotal),
        sourceCurrency: input.reportingCurrency,
        unresolved: false,
        appliedRate: null,
      };
    }

    const rateDate = this.resolveCurrentRateDate(now);
    const stored =
      rateDate === null
        ? null
        : await this.resolveRate(input.reportingCurrency, input.displayCurrency, rateDate);

    if (stored === null) {
      return {
        displayCurrency: input.displayCurrency,
        convertedTotal: null,
        sourceCurrency: input.reportingCurrency,
        unresolved: true,
        appliedRate: null,
      };
    }

    return {
      displayCurrency: input.displayCurrency,
      convertedTotal: round2(input.reportingTotal * Number(stored.rate)),
      sourceCurrency: input.reportingCurrency,
      unresolved: false,
      appliedRate: toAppliedRate(stored),
    };
  }

  /**
   * The most recently published rate day as of `now`, via the same pure
   * `resolveRateDate` the ADR-040 stamp uses — passing `now` as both the
   * anchor and the clamp yields "yesterday in Warsaw" under the shipped
   * `prev-business-day` rule, which each provider adapter then resolves onto
   * a day it actually published on. `null` is unreachable in practice (`now`
   * is always a valid `Date`), but is handled rather than asserted away.
   */
  private resolveCurrentRateDate(now: Date): string | null {
    return resolveRateDate(now, DEFAULT_FX_RATE_RULE, now);
  }

  /**
   * Resolve the stored rate for one `to` unit's worth of `from`, or `null` on
   * any failure — an unsupported display currency (`resolveRateSource`
   * throws for a currency no publisher quotes), an unsupported pair, a
   * transient provider failure, anything. This service never retries and
   * never throws past itself: a failed lookup for one currency must not abort
   * the batch for every other currency, nor the whole request.
   *
   * Returns the full {@link StoredExchangeRate}, not just the numeric rate
   * (#2778) — a caller multiplies via `Number(stored.rate)` and separately
   * builds an {@link AppliedRate} from the same row, so the two can never
   * describe different lookups.
   */
  private async resolveRate(
    from: string,
    to: string,
    rateDate: string
  ): Promise<StoredExchangeRate | null> {
    try {
      const source = resolveRateSource(to);
      return await this.rates.getRateFor({ source, from, to, rateDate });
    } catch (error) {
      this.logger.warn(
        `Display-currency rate ${from}->${to} on ${rateDate} could not be resolved: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return null;
    }
  }
}

/**
 * Project a {@link StoredExchangeRate} into the neutral, wire-safe
 * {@link AppliedRate} shape (#2778) — one place, reused by both conversion
 * modes, so the two can never diverge on which fields carry provenance.
 */
function toAppliedRate(stored: StoredExchangeRate): AppliedRate {
  return {
    from: stored.from,
    to: stored.to,
    rate: stored.rate,
    rateDate: stored.rateDate,
    source: stored.source,
    derivation: stored.derivation.kind,
    sourceRef: stored.sourceRef,
  };
}
