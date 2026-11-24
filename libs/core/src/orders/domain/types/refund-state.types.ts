/**
 * Order Refund State (#4130)
 *
 * The refund state of an order, DERIVED on read from its refund records. It is
 * deliberately a separate fact from `PaymentStatus`: that one is the channel's
 * claim and `persistOrder` rewrites it from the channel order on every poll, so
 * a refund-derived value stored there would be overwritten by the next poll.
 * Deriving on read has no writer to race and nothing to backfill.
 *
 * Pure, the `evaluateRefundCeiling` shape and sharing its fact subset: refunds
 * are gross money paid back, so a total that is explicitly tax-exclusive, a
 * missing total or a refund in another currency proves nothing and reads
 * `unknown` rather than a wrong `partial` / `full`. No FX, ever.
 *
 * @module libs/core/src/orders/domain/types
 */
import { minorUnitExponentFor } from '@openlinker/core/sales-documents';

import type { RefundCeilingOrderFacts } from './refund-ceiling.types';
import type { RefundSummary } from './refund-record.types';

export const OrderRefundStateValues = ['none', 'partial', 'full', 'unknown'] as const;

export type OrderRefundState = (typeof OrderRefundStateValues)[number];

export interface OrderRefundStateView {
  state: OrderRefundState;
  /** Decimal string at the order currency's minor unit; `null` when `state` is `none` or `unknown`. */
  refundedAmount: string | null;
  currency: string | null;
}

export function deriveOrderRefundState(
  order: RefundCeilingOrderFacts | null,
  refunds: RefundSummary | null
): OrderRefundStateView {
  if (refunds === null || refunds.count === 0) {
    return { state: 'none', refundedAmount: null, currency: null };
  }
  const unknown: OrderRefundStateView = { state: 'unknown', refundedAmount: null, currency: null };
  if (
    order === null ||
    order.totalAmount === null ||
    !Number.isFinite(order.totalAmount) ||
    order.currency === null ||
    order.currency.trim().length === 0
  ) {
    return unknown;
  }
  const currency = order.currency.trim().toUpperCase();
  if (refunds.currency.trim().toUpperCase() !== currency) {
    return unknown;
  }
  if ((order.totalTaxTreatment ?? order.taxTreatment) === 'exclusive') {
    return unknown;
  }
  const exponent = minorUnitExponentFor(currency);
  const refundedMinor = toMinorUnits(Number(refunds.totalAmount), exponent);
  if (Number.isNaN(refundedMinor)) {
    return unknown;
  }
  const totalMinor = toMinorUnits(order.totalAmount, exponent);
  const refundedAmount = (refundedMinor / 10 ** exponent).toFixed(exponent);
  if (refundedMinor <= 0) {
    return { state: 'none', refundedAmount: null, currency: null };
  }
  // Integer minor units, so the full-refund comparison is exact; an
  // acknowledged over-refund is still "fully refunded", never a new state.
  return {
    state: refundedMinor >= totalMinor ? 'full' : 'partial',
    refundedAmount,
    currency,
  };
}

function toMinorUnits(value: number, exponent: number): number {
  return Math.round((value + Number.EPSILON) * 10 ** exponent);
}
