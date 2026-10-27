/**
 * Refund Ceiling (#3289)
 *
 * The one pure rule for "how much of this order may still be refunded":
 * `order total - what is already refunded`. Both enforcement points read it -
 * the returns pre-flight (`ReturnRefundService.triggerRefund`, before the money
 * rail moves) and the record write (`OrderRefundService.recordRefund`) - so the
 * two cannot disagree about the same order. Pure: no I/O, no injected
 * dependency, the `splitShippingAcrossRates` shape.
 *
 * ## What the ceiling is, and is not
 *
 * - **Per ORDER, not per line.** `RefundRecord` carries no line reference.
 * - **A SOFT ceiling.** The verdict reports; the callers decide. By default an
 *   `exceeded` verdict is refused, and an explicit `acknowledgeAboveCeiling`
 *   lets it through (always logged) because a goodwill refund may legitimately
 *   exceed what the order was worth.
 * - **Fail-open on an unknown ceiling, and the unknown is NAMED.** A missing
 *   total or currency, a refund in another currency, or a total that excludes
 *   tax proves nothing about over-refund, so the answer is `unknown` with a
 *   closed reason - never indistinguishable from a checked pass (the
 *   `provenance: 'unknown'` idiom, #2321). No FX, ever.
 * - **Gross vs net.** The total's own inclusivity is
 *   `totalTaxTreatment ?? taxTreatment` (the `SalesDocumentViewService`
 *   `toOrderFacts` rule). Refunds are money paid back to the buyer, i.e. gross,
 *   so a total that is explicitly `exclusive` is not comparable to them without
 *   inventing a tax figure, and reads `unknown` (`total-excludes-tax`). An
 *   absent treatment is taken as comparable, matching the gate's own default.
 *
 * ## The `in_doubt` gap (stated, not closed)
 *
 * An attempt whose outcome is `in_doubt` writes NO `RefundRecord`
 * (`classifyRefundFailure` returns `movesMoney: false`), and neither `returns`
 * nor `return_lines` persists an amount. It is therefore structurally invisible
 * to `RefundSummary` and to this ceiling. The exposure is bounded - a return
 * holding an `in_doubt` line already refuses another attempt on THAT return - and
 * the uncovered case is an `in_doubt` attempt on return A followed by a fresh
 * attempt on return B of the same order. Closing it needs an amount column on
 * the attempt. `orders` also may not read returns' money states
 * (`orders -> returns` stays type-only).
 *
 * @module libs/core/src/orders/domain/types
 */
import { minorUnitExponentFor } from '@openlinker/core/sales-documents';

import { RefundAmountPrecisionException } from '../exceptions/refund-amount-precision.exception';
import type { RefundSummary } from './refund-record.types';

/** Machine-readable code both HTTP entry points answer 409 with. */
export const REFUND_CEILING_EXCEEDED_CODE = 'refund_ceiling_exceeded';

/** Greppable log tokens. */
export const REFUND_CEILING_ACKNOWLEDGED_LOG_TOKEN = 'refund_ceiling_exceeded_acknowledged';
export const REFUND_CEILING_UNKNOWN_LOG_TOKEN = 'refund_ceiling_unknown';

export const RefundCeilingUnknownReasonValues = [
  'order-unresolved',
  'order-total-unknown',
  'order-currency-unknown',
  'currency-differs',
  'total-excludes-tax',
  'amount-unreadable',
] as const;

export type RefundCeilingUnknownReason = (typeof RefundCeilingUnknownReasonValues)[number];

/** The slice of an order the ceiling reads. A structural subset of `OrderRecord`. */
export interface RefundCeilingOrderFacts {
  totalAmount: number | null;
  currency: string | null;
  taxTreatment: 'inclusive' | 'exclusive' | null;
  totalTaxTreatment: 'inclusive' | 'exclusive' | null;
}

/**
 * Everything a caller must hand over to have a refund checked. `returns` takes
 * no module edge to `orders`, so the controller resolves this and passes it in.
 */
export interface RefundCeilingContext {
  /** `null` when the order record could not be resolved. */
  order: RefundCeilingOrderFacts | null;
  /** `null` when the order has no refund yet. */
  alreadyRefunded: RefundSummary | null;
}

export interface RefundCeilingFigures {
  /** Decimal strings in the order's currency, at its minor unit. */
  ceiling: string;
  alreadyRefunded: string;
  requested: string;
  currency: string;
}

export type RefundCeilingVerdict =
  | ({ status: 'within' } & RefundCeilingFigures)
  | ({ status: 'exceeded' } & RefundCeilingFigures)
  | { status: 'unknown'; reason: RefundCeilingUnknownReason };

export interface EvaluateRefundCeilingInput {
  context: RefundCeilingContext | null;
  /** Decimal string. */
  requestedAmount: string;
  requestedCurrency: string;
}

export function evaluateRefundCeiling(input: EvaluateRefundCeilingInput): RefundCeilingVerdict {
  const order = input.context?.order ?? null;
  if (order === null) {
    return { status: 'unknown', reason: 'order-unresolved' };
  }
  if (order.totalAmount === null || !Number.isFinite(order.totalAmount)) {
    return { status: 'unknown', reason: 'order-total-unknown' };
  }
  if (order.currency === null || order.currency.trim().length === 0) {
    return { status: 'unknown', reason: 'order-currency-unknown' };
  }
  const currency = order.currency.trim().toUpperCase();
  if (input.requestedCurrency.trim().toUpperCase() !== currency) {
    return { status: 'unknown', reason: 'currency-differs' };
  }
  const prior = input.context?.alreadyRefunded ?? null;
  if (prior !== null && prior.currency.trim().toUpperCase() !== currency) {
    return { status: 'unknown', reason: 'currency-differs' };
  }
  if ((order.totalTaxTreatment ?? order.taxTreatment) === 'exclusive') {
    return { status: 'unknown', reason: 'total-excludes-tax' };
  }

  const exponent = minorUnitExponentFor(currency);
  const ceilingMinor = toMinorUnits(order.totalAmount, exponent);
  const refundedMinor = prior === null ? 0 : toMinorUnits(Number(prior.totalAmount), exponent);
  const requestedMinor = toMinorUnits(Number(input.requestedAmount), exponent);
  if (Number.isNaN(refundedMinor) || Number.isNaN(requestedMinor)) {
    return { status: 'unknown', reason: 'amount-unreadable' };
  }

  const figures: RefundCeilingFigures = {
    ceiling: fromMinorUnits(ceilingMinor, exponent),
    alreadyRefunded: fromMinorUnits(refundedMinor, exponent),
    requested: fromMinorUnits(requestedMinor, exponent),
    currency,
  };
  // Integer minor units: the comparison is exact, never a float one.
  return refundedMinor + requestedMinor > ceilingMinor
    ? { status: 'exceeded', ...figures }
    : { status: 'within', ...figures };
}

/**
 * Scale of `refund_records.amount` (`numeric(12,2)`). A KWD refund of 0.123 is
 * refused rather than accepted and silently stored as 0.12.
 */
const REFUND_AMOUNT_STORED_FRACTION_DIGITS = 2;

/**
 * Refuse an amount with more fraction digits than the currency allows, or than
 * the column stores (R-18). Validation lives here rather than in a DTO because
 * only the service knows the currency the amount is denominated in.
 */
export function assertRefundAmountPrecision(amount: string, currency: string): void {
  const allowed = Math.min(
    minorUnitExponentFor(currency.trim().toUpperCase()),
    REFUND_AMOUNT_STORED_FRACTION_DIGITS
  );
  const fraction = amount.trim().split('.')[1] ?? '';
  if (fraction.length > allowed) {
    throw new RefundAmountPrecisionException(amount, currency.trim().toUpperCase(), allowed);
  }
}

/** One sentence naming every figure, shared by the refusal and the warn logs. */
export function describeRefundCeilingVerdict(
  internalOrderId: string,
  verdict: RefundCeilingVerdict
): string {
  if (verdict.status === 'unknown') {
    return `order ${internalOrderId}: ceiling unknown (${verdict.reason})`;
  }
  return (
    `order ${internalOrderId}: ceiling ${verdict.ceiling} ${verdict.currency}, ` +
    `already refunded ${verdict.alreadyRefunded}, requested ${verdict.requested}`
  );
}

function toMinorUnits(value: number, exponent: number): number {
  return Math.round((value + Number.EPSILON) * 10 ** exponent);
}

function fromMinorUnits(minor: number, exponent: number): string {
  return (minor / 10 ** exponent).toFixed(exponent);
}
