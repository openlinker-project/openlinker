/**
 * Order FX Stamp Outcome Types
 *
 * The answer a single stamp attempt reached (#2125, ADR-040), plus the sweep's
 * per-tick tally.
 *
 * `FxStampOutcome` is a discriminated union rather than a boolean because THREE
 * callers need to tell the three answers apart and each reads a different pair:
 * the retry handler maps `terminal` to an ADR-007 `business_failure` and
 * `deferred` to a retryable throw, `persistOrder` refreshes its returned record
 * only for `stamped`, and the sweep tallies all three.
 *
 * @module libs/core/src/orders/domain/types
 */

/**
 * Why a stamp attempt reached a TERMINAL answer - one no retry can change.
 *
 * - `no-placed-at` - the snapshot carries no usable `placedAt`, so no rate day
 *   can be derived. WooCommerce orders legitimately arrive this way.
 * - `unsupported-pair` - the publisher does not quote the pair, or the
 *   walk-back was exhausted.
 * - `unsupported-reporting-currency` - the resolved reporting currency has no
 *   publisher at all (`resolveRateSource` refused it).
 * - `no-rate-source` - no provider is registered for the resolved publisher, a
 *   host-wiring fault (`FxIntegrationModule` missing).
 * - `no-native-total` - the snapshot carries no well-formed
 *   `totals.total` / `totals.currency` pair, so there is nothing to convert.
 * - `order-not-found` - no `order_records` row matched the id.
 */
export const FX_STAMP_TERMINAL_REASONS = [
  'no-placed-at',
  'no-native-total',
  'unsupported-pair',
  'unsupported-reporting-currency',
  'no-rate-source',
  'order-not-found',
] as const;

export type FxStampTerminalReason = (typeof FX_STAMP_TERMINAL_REASONS)[number];

/** The order now carries a reportable figure in the reporting currency. */
export interface FxStampStampedOutcome {
  readonly kind: 'stamped';
  readonly reportingCurrency: string;
  readonly reportingTotalAmount: number;
  /** `null` when the order's own currency already equalled the reporting one. */
  readonly exchangeRateId: string | null;
  /**
   * `true` when the figure was already on the row and this attempt wrote
   * nothing. Distinguished because the retry handler must answer `'ok'` for it
   * (a re-delivered job is a success, not a failure) while nothing was written.
   */
  readonly alreadyStamped: boolean;
}

/** No stamp, and no retry will produce one. */
export interface FxStampTerminalOutcome {
  readonly kind: 'terminal';
  readonly reason: FxStampTerminalReason;
}

/** The attempt degraded to the retry job; a later attempt may still stamp. */
export interface FxStampDeferredOutcome {
  readonly kind: 'deferred';
  /** Operator-readable cause, already stripped of any provider stack. */
  readonly reason: string;
  /**
   * `false` when the retry job could not even be enqueued - the reconcile sweep
   * is then the only remaining route to a stamp.
   */
  readonly retryEnqueued: boolean;
}

export type FxStampOutcome =
  | FxStampStampedOutcome
  | FxStampTerminalOutcome
  | FxStampDeferredOutcome;

/** Bounds one reconcile-sweep tick. */
export interface OrderFxSweepOptions {
  /** Max unstamped rows to pull per tick. */
  readonly limit: number;
  /**
   * Skip rows created before this instant. Bounds the scan away from the whole
   * pre-feature backlog; `fxStampedAt` bounds it away from re-selecting the
   * rows the sweep has already answered.
   */
  readonly createdSince: Date;
}

/** What one reconcile-sweep tick did. */
export interface OrderFxSweepResult {
  /** Rows the bounded page returned. */
  readonly scanned: number;
  /** Rows this tick stamped (excludes rows that were already stamped). */
  readonly stamped: number;
  /** Rows that reached a terminal answer. */
  readonly terminal: number;
  /** Rows still deferred after this tick. */
  readonly deferred: number;
}
