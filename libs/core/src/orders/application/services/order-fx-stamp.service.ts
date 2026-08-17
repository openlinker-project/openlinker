/**
 * Order FX Stamp Service
 *
 * Stamps an order's total into the deployment's reporting currency (#2125,
 * ADR-040) and is the ONE place that decides, per attempt, between a stamp, a
 * terminal answer and a retry.
 *
 * Three properties shape everything below.
 *
 *  1. IT NEVER THROWS. The order is already persisted by the time the inline
 *     caller reaches here, so a rate provider being down must not turn a
 *     successful ingestion into a failed one. Every failure is folded into the
 *     returned `FxStampOutcome`.
 *  2. THE INTENT IS READ AND PINNED BEFORE ANYTHING ELSE. If the row already
 *     carries `fxIntendedCurrency`, the settings service is not consulted at
 *     all. Otherwise the resolved value is claimed with a conditional write and
 *     a loser adopts the winner's intent. Without this, an order that degraded
 *     to the retry job could be stamped in a different currency than the same
 *     order stamped inline - making provider availability a silent input to a
 *     financial figure - and the reconcile sweep, whose lag is unbounded by
 *     design, could reclassify arbitrary history after any setting change.
 *  3. THE CONVERSION MULTIPLIES. `ExchangeRate.rate` is `to` units per one
 *     `from` unit by contract; dividing produces a plausible number, never
 *     throws, and is wrong by the square of the rate.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderFxStampService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  CURRENCY_RATE_SERVICE_TOKEN,
  DEFAULT_FX_RATE_RULE,
  ICurrencyRateService,
  IReportingCurrencySettingsService,
  RateUnsupportedPairError,
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  ReportingCurrencyUnsupportedError,
  UnregisteredExchangeRateSourceError,
  isFxRateRule,
  resolveRateDate,
  resolveRateSource,
} from '@openlinker/core/currency';
import type { ExchangeRateSource, FxRateRule } from '@openlinker/core/currency';
import { JOB_ENQUEUE_TOKEN, JobEnqueuePort } from '@openlinker/core/sync';
import type { SyncJobRequest } from '@openlinker/core/sync';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import type { OrderRecord } from '../../domain/entities/order-record.entity';
import type { OrderFxIntent } from '../../domain/types/order-fx.types';
import type {
  FxStampOutcome,
  FxStampTerminalOutcome,
  FxStampTerminalReason,
  OrderFxSweepOptions,
  OrderFxSweepResult,
} from '../../domain/types/order-fx-stamp.types';
import type { IOrderFxStampService } from '../interfaces/order-fx-stamp.service.interface';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';

/**
 * Money is kept to 2 decimal places - the minor-unit precision of the ISO-4217
 * currencies in play, and the scale of `order_records.reportingTotalAmount`.
 *
 * Hand-rolled rather than reusing `pricing-rule.types.ts`'s `round2dp`, which
 * is module-private AND clamps with `Math.max(0, ...)`. That clamp is right for
 * a listing price and catastrophic here: it would silently turn a negative
 * total (a refund, a correction) into `0.00` and report it as fact. This is the
 * same idiom `InvoiceService` uses.
 */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class OrderFxStampService implements IOrderFxStampService {
  private readonly logger = new Logger(OrderFxStampService.name);

  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly repository: OrderRecordRepositoryPort,
    @Inject(REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN)
    private readonly settings: IReportingCurrencySettingsService,
    @Inject(CURRENCY_RATE_SERVICE_TOKEN)
    private readonly rates: ICurrencyRateService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  async stamp(internalOrderId: string): Promise<FxStampOutcome> {
    const record = await this.repository.findById(internalOrderId);
    if (!record) {
      // No row means no columns to write, so this cannot even be marked
      // terminal. Reported terminal so a retry job dies here rather than
      // spinning ten times against an id that will never exist.
      this.logger.warn(`FX stamp skipped: no order record for ${internalOrderId}`);
      return { kind: 'terminal', reason: 'order-not-found' };
    }

    // Already answered with a figure - report it and touch nothing. This is the
    // path a re-poll of a stamped order takes, so it must cost zero provider
    // calls; `stampFxIfAbsent` would no-op anyway, but only after a full rate
    // lookup had already been paid for.
    if (record.reportingCurrency !== null && record.reportingTotalAmount !== null) {
      return {
        kind: 'stamped',
        reportingCurrency: record.reportingCurrency,
        reportingTotalAmount: record.reportingTotalAmount,
        exchangeRateId: record.exchangeRateId,
        alreadyStamped: true,
      };
    }

    let intent: OrderFxIntent | undefined;
    let source: ExchangeRateSource | undefined;
    let rateDate: string | undefined;
    let nativeCurrency: string | undefined;

    try {
      // (0) Intent first - see the file header for why this precedes the rate
      // date rather than following it.
      intent = await this.resolveIntent(record);

      // (1) Which publisher serves this reporting currency. Pure; throws the
      // terminal `ReportingCurrencyUnsupportedError` for a currency with none.
      // Resolved before the equal-currency short-circuit deliberately: a
      // reporting currency no publisher quotes is a deployment OpenLinker
      // cannot honestly report in at all, and the settings service's own gate
      // makes that state unreachable in practice.
      source = resolveRateSource(intent.reportingCurrency);

      // (2) Which published day. `null` is terminal, and is returned rather
      // than thrown for a missing/unparseable `placedAt`.
      const resolvedDate = resolveRateDate(record.placedAt, intent.fxRule);
      if (resolvedDate === null) {
        return await this.recordTerminal(record.internalOrderId, 'no-placed-at');
      }
      rateDate = resolvedDate;

      const native = record.nativeTotals;
      if (native === undefined) {
        return await this.recordTerminal(record.internalOrderId, 'no-native-total');
      }
      nativeCurrency = native.currency;

      // (3) Nothing to convert. No rate lookup and no I/O beyond the stamp
      // write itself - `round2` is identity for a well-formed 2dp total and
      // exists only so a source reporting more precision cannot leave the
      // rounding to the database.
      if (native.currency === intent.reportingCurrency) {
        return await this.applyStamp(record.internalOrderId, {
          reportingCurrency: intent.reportingCurrency,
          reportingTotalAmount: round2(native.amount),
          exchangeRateId: null,
          fxRule: intent.fxRule,
        });
      }

      // (4) MULTIPLY - see property 3 in the file header.
      const rate = await this.rates.getRateFor({
        source,
        from: native.currency,
        to: intent.reportingCurrency,
        rateDate,
      });

      return await this.applyStamp(record.internalOrderId, {
        reportingCurrency: intent.reportingCurrency,
        reportingTotalAmount: round2(native.amount * Number(rate.rate)),
        exchangeRateId: rate.id,
        fxRule: intent.fxRule,
      });
    } catch (error) {
      // (5) Terminal classifications. Each says the same thing in a different
      // vocabulary: no number of retries changes the answer, so per ADR-007
      // this is a business failure, not a retry.
      const terminalReason = this.classifyTerminal(error);
      if (terminalReason) {
        return await this.recordTerminal(record.internalOrderId, terminalReason);
      }

      // (6) Everything else is retryable.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`FX stamp deferred to the retry job: ${reason}`, {
        internalOrderId: record.internalOrderId,
        from: nativeCurrency ?? null,
        to: intent?.reportingCurrency ?? null,
        rateDate: rateDate ?? null,
        source: source ?? null,
      });

      // The enqueue gets its OWN try/catch, nested inside this one. Its
      // dependencies (Postgres, Redis) are correlated with the failures that
      // trigger it, so a single flat catch would swallow the enqueue's throw
      // too and the order would be lost behind nothing but the warn above.
      const retryEnqueued = await this.enqueueRetry(record);
      return { kind: 'deferred', reason, retryEnqueued };
    }
  }

  /**
   * One bounded page per tick, walked SEQUENTIALLY. A page of foreign-currency
   * orders on distinct days is a page of provider calls; fanning them out in
   * parallel would burst a public reference-rate API for no latency benefit
   * anyone is waiting on. Each `stamp` swallows its own failure, so one bad row
   * cannot abort the tick.
   */
  async sweep(
    sourceConnectionId: string,
    options: OrderFxSweepOptions
  ): Promise<OrderFxSweepResult> {
    const ids = await this.repository.findUnstampedFxOrderIds(sourceConnectionId, {
      limit: options.limit,
      createdSince: options.createdSince,
    });

    let stamped = 0;
    let terminal = 0;
    let deferred = 0;

    for (const internalOrderId of ids) {
      const outcome = await this.stamp(internalOrderId);
      switch (outcome.kind) {
        case 'stamped':
          // An already-stamped row cannot legitimately appear in this page (the
          // predicate excludes it), so counting only fresh stamps keeps the
          // tally honest if a concurrent inline attempt wins the race.
          if (!outcome.alreadyStamped) {
            stamped += 1;
          }
          break;
        case 'terminal':
          terminal += 1;
          break;
        case 'deferred':
          deferred += 1;
          break;
      }
    }

    return { scanned: ids.length, stamped, terminal, deferred };
  }

  /**
   * Resolve the reporting currency + rule this order is stamped against,
   * pinning it on the first attempt.
   *
   * A persisted intent wins outright and the settings service is NOT consulted -
   * that is the whole point of the column, not an optimisation.
   */
  private async resolveIntent(record: OrderRecord): Promise<OrderFxIntent> {
    const persisted = this.readPersistedIntent(record);
    if (persisted) {
      return persisted;
    }

    const intent: OrderFxIntent = {
      reportingCurrency: await this.settings.resolve(),
      // A code constant, not a setting: `resolveRateDate` implements exactly
      // this rule, and a second knob would let an operator pick a rule with no
      // implementation behind it.
      fxRule: DEFAULT_FX_RATE_RULE,
    };

    const won = await this.repository.claimFxIntentIfAbsent(record.internalOrderId, intent);
    if (won) {
      return intent;
    }

    // Lost the claim: a concurrent first attempt pinned its own intent. Adopt
    // it rather than proceeding with ours - two attempts on one order must never
    // resolve to different currencies.
    const refreshed = await this.repository.findById(record.internalOrderId);
    const adopted = refreshed ? this.readPersistedIntent(refreshed) : undefined;
    if (adopted) {
      if (adopted.reportingCurrency !== intent.reportingCurrency) {
        this.logger.log(
          `FX intent claim lost for ${record.internalOrderId}; adopting the winner's ` +
            `'${adopted.reportingCurrency}' over the locally resolved '${intent.reportingCurrency}'`
        );
      }
      return adopted;
    }

    // Neither won nor able to read a winner - the row vanished, or the claim
    // reported no match. Proceed with the locally resolved intent; the stamp's
    // own conditional write remains the stamp-once guard.
    return intent;
  }

  /** The intent already on the row, or `undefined` when none was ever claimed. */
  private readPersistedIntent(record: OrderRecord): OrderFxIntent | undefined {
    if (record.fxIntendedCurrency === null) {
      return undefined;
    }
    return {
      reportingCurrency: record.fxIntendedCurrency,
      fxRule: this.readPersistedRule(record.fxRule),
    };
  }

  /**
   * `OrderRecord.fxRule` is a bare `string` because a newer deployment's value
   * must surface as-is rather than be dropped. The WRITE shape is the closed
   * union, so an unrecognised value has to be narrowed to a member here; the
   * default is used with a warning rather than failing the stamp, since a rule
   * this deployment cannot implement is not a reason to leave the order with no
   * reportable figure at all.
   */
  private readPersistedRule(persisted: string | null): FxRateRule {
    if (persisted !== null && isFxRateRule(persisted)) {
      return persisted;
    }
    if (persisted !== null) {
      this.logger.warn(
        `Unrecognised persisted fxRule '${persisted}'; stamping against '${DEFAULT_FX_RATE_RULE}'`
      );
    }
    return DEFAULT_FX_RATE_RULE;
  }

  /**
   * Which terminal reason a caught error maps to, or `undefined` when it is
   * retryable. `RateUnavailableTransientError` deliberately has no entry - it
   * falls through to the retry path.
   */
  private classifyTerminal(error: unknown): FxStampTerminalReason | undefined {
    if (error instanceof RateUnsupportedPairError) {
      return 'unsupported-pair';
    }
    if (error instanceof UnregisteredExchangeRateSourceError) {
      return 'no-rate-source';
    }
    if (error instanceof ReportingCurrencyUnsupportedError) {
      return 'unsupported-reporting-currency';
    }
    return undefined;
  }

  /**
   * Write the stamp, or adopt the winner when a concurrent attempt got there
   * first. `stampFxIfAbsent` returning `false` is a normal outcome, not an
   * error: the already-reported figure survives untouched.
   */
  private async applyStamp(
    internalOrderId: string,
    stamp: {
      reportingCurrency: string;
      reportingTotalAmount: number;
      exchangeRateId: string | null;
      fxRule: FxRateRule;
    }
  ): Promise<FxStampOutcome> {
    const wrote = await this.repository.stampFxIfAbsent(internalOrderId, {
      ...stamp,
      fxStampedAt: new Date(),
    });

    if (wrote) {
      return {
        kind: 'stamped',
        reportingCurrency: stamp.reportingCurrency,
        reportingTotalAmount: stamp.reportingTotalAmount,
        exchangeRateId: stamp.exchangeRateId,
        alreadyStamped: false,
      };
    }

    const refreshed = await this.repository.findById(internalOrderId);
    if (refreshed && refreshed.reportingCurrency !== null) {
      return {
        kind: 'stamped',
        reportingCurrency: refreshed.reportingCurrency,
        reportingTotalAmount: refreshed.reportingTotalAmount ?? stamp.reportingTotalAmount,
        exchangeRateId: refreshed.exchangeRateId,
        alreadyStamped: true,
      };
    }

    // The write matched no row at all (the order was deleted between the read
    // and the write). Nothing to stamp and nothing to retry.
    this.logger.warn(`FX stamp write matched no row for ${internalOrderId}`);
    return { kind: 'terminal', reason: 'order-not-found' };
  }

  /**
   * Warn once and durably mark the row answered. The marker write is
   * BEST-EFFORT and never reclassifies the outcome: a terminal answer that
   * failed to persist its marker is still terminal, and re-raising here would
   * enqueue a retry for a condition no retry can change.
   */
  private async recordTerminal(
    internalOrderId: string,
    reason: FxStampTerminalReason
  ): Promise<FxStampTerminalOutcome> {
    this.logger.warn(`FX stamp terminal: reason=${reason}`, { internalOrderId, reason });

    try {
      await this.repository.markFxTerminalIfAbsent(internalOrderId, new Date());
    } catch (error) {
      // Only consequence: the reconcile sweep will revisit this row and reach
      // the same terminal answer again.
      this.logger.warn(
        `Failed to record the terminal FX marker for ${internalOrderId}: ` +
          (error instanceof Error ? error.message : String(error))
      );
    }

    return { kind: 'terminal', reason };
  }

  /**
   * Enqueue the bounded retry. One job per order: the idempotency key carries no
   * attempt counter, so repeated inline failures for one order collapse onto a
   * single job instead of one per re-poll.
   */
  private async enqueueRetry(record: OrderRecord): Promise<boolean> {
    const request: SyncJobRequest = {
      jobType: 'marketplace.order.fxStamp',
      // `SyncJob.connectionId` is non-nullable and the stamp itself is
      // connection-agnostic, so the order's own source connection carries the
      // job - the same connection the reconcile sweep is scoped to.
      connectionId: record.sourceConnectionId,
      payload: { schemaVersion: 1, internalOrderId: record.internalOrderId },
      idempotencyKey: `fx:${record.internalOrderId}`,
    };

    try {
      const { jobId } = await this.jobEnqueue.enqueueJob(request);
      this.logger.log(
        `FX stamp retry enqueued: jobId=${jobId} order=${record.internalOrderId} ` +
          `connection=${record.sourceConnectionId}`
      );
      return true;
    } catch (error) {
      // Logged DISTINCTLY from the stamp failure above: this is the more serious
      // of the two, because it leaves the hourly reconcile sweep as the only
      // remaining route to a stamp for this order.
      this.logger.warn(
        `FX stamp retry could not be enqueued for order ${record.internalOrderId}; ` +
          `the reconcile sweep is now the only route to a stamp: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return false;
    }
  }
}
