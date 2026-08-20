/**
 * Order FX Read Types
 *
 * Aggregate shapes for the read side of the per-order FX snapshot (#2124) -
 * consumed by the reporting-currency settings surface, which has to tell an
 * operator how much history a currency change would split.
 *
 * Kept apart from `order-fx.types.ts` (which carries the WRITE shapes
 * `OrderFxIntent` / `OrderFxStamp`) because nothing on the stamp path reads
 * these, and because the two travel in opposite directions across the port.
 *
 * @module libs/core/src/orders/domain/types
 */

/**
 * How many order rows already carry a stamp in one reporting currency.
 *
 * Reported PER CURRENCY rather than as a single total on purpose: a deployment
 * whose setting changed holds several reporting-currency ERAS, and "3 947 PLN
 * + 1 284 EUR" is the fact an operator needs before accepting another split.
 * The total is a sum away; the breakdown is not recoverable from a total.
 */
export interface StampedReportingCurrencyCount {
  readonly reportingCurrency: string;
  readonly count: number;
}
