/**
 * Order FX Snapshot Types
 *
 * The two write shapes of the per-order reporting-currency snapshot (#2124,
 * ADR-040): the INTENT claimed at the first stamp attempt and the STAMP itself.
 *
 * They are separate types because they are separate lifecycle events, not two
 * views of one write. The intent pins `reportingCurrency` + `fxRule` before any
 * rate lookup happens, so an order that degrades to the retry job is later
 * stamped against the currency its FIRST attempt resolved rather than whatever
 * the live setting says by then. The stamp lands once, and only once - see
 * `OrderRecordRepositoryPort.claimFxIntentIfAbsent` /
 * `OrderRecordRepositoryPort.stampFxIfAbsent` for the guards that enforce it.
 *
 * `fxRule` is typed as the closed `FxRateRule` union on both WRITE shapes (a
 * caller must pick a rule OpenLinker actually implements), while the value read
 * back onto `OrderRecord` stays a bare `string` - a row written by a newer
 * deployment must surface as-is rather than be coerced or dropped.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { FxRateRule } from '@openlinker/core/currency';

/**
 * The complete stamp, written by one guarded `UPDATE` so the group cannot
 * half-apply.
 *
 * `exchangeRateId` is legitimately `null` on the same-currency path (no
 * conversion happened, so no registry row is referenced) - it is therefore
 * NEVER the discriminator for "was this order stamped?". That question is
 * answered by `reportingCurrency IS NULL`.
 */
export interface OrderFxStamp {
  /** ISO-4217 currency the figure below is expressed in. */
  readonly reportingCurrency: string;
  /** The order total converted into `reportingCurrency`, rounded to 2dp. */
  readonly reportingTotalAmount: number;
  /** `exchange_rates.id` the conversion used; `null` when no rate was needed. */
  readonly exchangeRateId: string | null;
  /** Which published day's rate the stamp was taken against. */
  readonly fxRule: FxRateRule;
  /** Instant the stamp attempt reached a terminal answer. */
  readonly fxStampedAt: Date;
}

/**
 * The first-attempt snapshot, claimed BEFORE any rate lookup so every later
 * attempt (retry job, sweep) reuses the same target currency and rule.
 */
export interface OrderFxIntent {
  /** The reporting currency resolved at the first attempt. */
  readonly reportingCurrency: string;
  /** The rule resolved at the first attempt. */
  readonly fxRule: FxRateRule;
}
