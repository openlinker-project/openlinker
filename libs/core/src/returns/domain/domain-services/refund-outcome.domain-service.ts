/**
 * Refund Outcome Classification (#2371, ADR-056)
 *
 * The ONE place that reads what a `RefundExecutor` said about a refund. Pure —
 * no I/O, no injected dependency, no clock, no argument mutation — the same
 * shape as #2370's `restock-outcome.domain-service.ts` and every other rule
 * engine in this tree.
 *
 * ## Three inversions from its restock sibling, all deliberate
 *
 * The restock classifier and this one look alike and decide opposite things,
 * because the recoverability of a mistake is opposite in each direction.
 *
 *  1. **Any throw is `in_doubt`, never `denied`.** `classifyRestockFailure`
 *     treats every throw as a BLOCK, which is safe there: a blocked restock is
 *     recoverable by operator attestation while a double restock is not. Here
 *     BOTH directions are unrecoverable, so a failure is recorded as *boundary
 *     crossed, outcome unobserved* and blocks any second attempt. Classifying a
 *     timeout as `denied` would authorise a second refund of money that may
 *     already have moved.
 *  2. **`refunded` requires the provider's OWN instant.** A result claiming
 *     `outcome: 'refunded'` with `refundedAt: null` is downgraded to
 *     `triggered`, because OL's clock may never stand in for a channel-reported
 *     fact (#2336/#2367) and the operator surface renders this as *"Confirmed by
 *     {source}"*. Trusting the word without the instant would let an adapter
 *     turn an OL guess into a marketplace observation.
 *  3. **Only a terminal `denied` unblocks.** That is the ADR-042 discipline by
 *     name: the provider is known to have created nothing, so another connection
 *     — or another attempt — is free to proceed.
 *
 * A value this build does not recognise is treated as `in_doubt`, never as a
 * success and never as a denial: an outcome we did not understand is precisely
 * the case where guessing costs real money.
 *
 * @module domain/domain-services
 * @see docs/architecture/adrs/056-refund-and-fiscal-authority-never-leave-ol.md
 * @see libs/core/src/orders/domain/ports/capabilities/refund-executor.capability.ts
 */
import type { RefundExecutedBy } from '@openlinker/core/orders';
import type { RefundExecutionResult } from '@openlinker/core/orders';

import type { ReturnMoneyState } from '../types/return-line.types';

/**
 * What the classifier decided, in the vocabulary the money column persists.
 *
 * `movesMoney` is reported rather than re-derived by the caller because it is
 * the single most consequential bit in this slice: it decides whether a
 * `RefundRecord` is proposed at all. Deriving it at the call site is how the
 * rule and the record start disagreeing about whether the buyer was paid.
 */
export interface RefundOutcome {
  moneyState: ReturnMoneyState;
  executedBy: RefundExecutedBy;
  providerRefundId: string | null;
  /**
   * The instant to stamp on the linked `RefundRecord`, or `null` when the
   * provider reported none and the caller must supply its own (which it may
   * legitimately do for an out-of-band confirmation — OL is the sensor for an
   * act the operator performed inside OpenLinker).
   */
  settledAt: Date | null;
  providerMessage: string | null;
  /** True only where money actually moved — `refunded` and `triggered`. */
  movesMoney: boolean;
}

/**
 * Classify a successful `executeRefund` return value.
 */
export function classifyRefundOutcome(result: RefundExecutionResult): RefundOutcome {
  const base = {
    executedBy: 'refund_executor' as const,
    providerRefundId: result.providerRefundId,
    providerMessage: result.providerMessage,
  };

  if (result.outcome === 'denied') {
    // Terminal: the provider moved nothing, so no record and the line reopens.
    return { ...base, moneyState: 'denied', settledAt: null, movesMoney: false };
  }

  if (result.outcome === 'refunded') {
    // Rule 2 — the word alone is not an observation; the instant is.
    if (result.refundedAt === null) {
      return { ...base, moneyState: 'triggered', settledAt: null, movesMoney: true };
    }
    return {
      ...base,
      moneyState: 'refunded',
      settledAt: result.refundedAt,
      movesMoney: true,
    };
  }

  if (result.outcome === 'accepted') {
    return { ...base, moneyState: 'triggered', settledAt: null, movesMoney: true };
  }

  // A value this build does not know. Never a success, never a denial.
  return {
    ...base,
    moneyState: 'in_doubt',
    settledAt: null,
    movesMoney: false,
  };
}

/**
 * Classify a throw from `executeRefund` — or from resolving the adapter that
 * would have served it once the boundary was already crossed.
 *
 * Always `in_doubt`. See inversion 1 in the header: core cannot name a platform
 * exception type and must not try, and there is no error shape from which
 * "definitely no money moved" can be safely inferred.
 */
export function classifyRefundFailure(error: unknown): RefundOutcome {
  return {
    moneyState: 'in_doubt',
    executedBy: 'refund_executor',
    providerRefundId: null,
    settledAt: null,
    providerMessage: extractMessage(error),
    movesMoney: false,
  };
}

/**
 * The v1 path: no adapter implements `RefundExecutor`, so a human moved the
 * money and OL is recording that fact.
 *
 * Kept beside the two above so every value the money column can hold is minted
 * in one file. Note it is NOT `in_doubt`: no boundary was crossed, so claiming
 * uncertainty about a call that never happened would be a false statement.
 */
export function refundConfirmedOutOfBand(at: Date): RefundOutcome {
  return {
    moneyState: 'triggered',
    executedBy: 'operator_out_of_band',
    providerRefundId: null,
    settledAt: at,
    providerMessage: null,
    movesMoney: true,
  };
}

function extractMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return 'the source refused the refund without a message';
}
