/**
 * Payment facts consistency (#3294)
 *
 * An ingested order states three payment facts - `paymentMethod` (how the buyer
 * pays), `paymentStatus` (may it ship) and `codToCollect` (what the courier
 * collects) - and each source adapter derives them from its own native data.
 * They are independent axes, but not independent in value: some combinations
 * contradict each other, and a contradiction here is a wrong label or a wrong
 * collected amount.
 *
 * This is the single statement of which combinations are contradictory, as a
 * pure function over the three facts. Every order-source adapter spec runs its
 * mapped output through it, so a mapper that attaches a collect amount to a
 * non-COD order - the shape that would pre-fill a courier label with money the
 * buyer already paid - fails a test instead of reaching a courier. It lives with
 * the types it constrains (the pure-rule exception in
 * `docs/engineering-standards.md`) and changes with them.
 *
 * An absent fact constrains nothing: a source that does not report a method
 * cannot contradict its status.
 *
 * What this deliberately does NOT flag is cash on delivery beside `paid`. That
 * pair is legitimate once the courier has collected - WooCommerce stamps a
 * payment date, PrestaShop moves the order to a paid state - so a rule against
 * it would reject true data. The defect that motivated this file (a COD order
 * read as paid from its status ALONE) is pinned by the WooCommerce adapter's
 * own cases, where the evidence behind the status is known.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { CodToCollect } from './cod-to-collect.types';
import type { PaymentMethod } from './payment-method.types';
import type { PaymentStatus } from './payment-status.types';

export interface PaymentFacts {
  readonly paymentMethod?: PaymentMethod;
  readonly paymentStatus?: PaymentStatus;
  readonly codToCollect?: CodToCollect;
}

/** Every contradiction a set of payment facts contains, as stable codes. */
export const PaymentFactsViolationValues = [
  /** Reported as COD by status, yet the method says it is not (online or transfer). */
  'cod-status-with-non-cod-method',
  /** A collect amount exists but the method is not cash on delivery. */
  'cod-amount-without-cod-method',
] as const;

export type PaymentFactsViolation = (typeof PaymentFactsViolationValues)[number];

export function checkPaymentFactsConsistency(facts: PaymentFacts): PaymentFactsViolation[] {
  const violations: PaymentFactsViolation[] = [];
  const { paymentMethod, paymentStatus, codToCollect } = facts;

  if (paymentStatus === 'cod' && (paymentMethod === 'online' || paymentMethod === 'bank_transfer')) {
    violations.push('cod-status-with-non-cod-method');
  }

  // `unknown` is covered too: it must never carry a collect amount, because the
  // amount is what a label pre-fills from.
  if (
    codToCollect !== undefined &&
    paymentMethod !== undefined &&
    paymentMethod !== 'cash_on_delivery'
  ) {
    violations.push('cod-amount-without-cod-method');
  }

  return violations;
}
