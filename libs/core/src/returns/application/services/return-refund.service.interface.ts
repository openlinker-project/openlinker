/**
 * Return Refund Service Interface (#2371, `W2-34`, ADR-056)
 *
 * The refund TRIGGER, and the observation that is the only way a line reaches
 * `refunded`.
 *
 * @module libs/core/src/returns/application/services
 */
// From the MAIN orders barrel, not the `/types` cycle-breaker: `RefundExecutedBy`
// is not on that sub-barrel, whose gate admits only dependency-free leaves with
// a consumer that cannot use the main barrel. This file can — `ReturnDeclineService`
// already imports the main barrel from the same folder.
import type { RefundExecutedBy, RefundReason } from '@openlinker/core/orders';

import type { ReturnRecord } from '../../domain/entities/return-record.entity';
import type { ReturnMoneyState } from '../../domain/types/return-line.types';

export interface TriggerRefundInput {
  /** Decimal string, matching the `RefundRecord.amount` convention. */
  amount: string;
  /** ISO 4217, 3-letter. */
  currency: string;
  reason: RefundReason;
  note?: string | null;
  /** The operator, where one is acting. */
  actorUserId?: string | null;
}

/**
 * The facts a caller needs to write the linked `RefundRecord`.
 *
 * **Deliberately a `returns`-owned type, NOT `orders`' `CreateRefundRecordInput`.**
 * Returning the other context's write-input would make this contract break
 * whenever `orders` adds a required field to its own write, and #2100 — the
 * precedent this reporting shape follows — returns a NEUTRAL outcome its caller
 * maps, precisely so the reporting context owns its type.
 */
export interface ReturnRefundRecordIntent {
  returnId: string;
  internalOrderId: string;
  amount: string;
  currency: string;
  reason: RefundReason;
  note: string | null;
  /** Who moved the money. Never inferred by the caller — see ADR-056. */
  executedBy: RefundExecutedBy;
  /**
   * The instant to stamp. The provider's own where it reported one; otherwise
   * OL's, which is legitimate here because confirming an out-of-band refund is
   * an act the operator performed inside OpenLinker with OL as the sensor (the
   * #2370 `occurredAt` rule).
   */
  recordedAt: Date;
  providerRefundId: string | null;
}

export interface TriggerRefundResult {
  record: ReturnRecord;
  /** The state the return's lines now carry. */
  moneyState: ReturnMoneyState;
  /** The lines this attempt claimed. */
  claimedLineIds: string[];
  /**
   * What to write, or `null` wherever no money moved (`denied`, `in_doubt`).
   *
   * **This service writes no `RefundRecord` itself** — #2371's own wording is
   * that "the existing capture endpoint writes the linked `RefundRecord`", and
   * persisting here would need an `orders` write token inside `ReturnsModule`.
   * The caller (#2376) owns the write.
   *
   * The two writes are not atomic and cannot be — two contexts, two
   * repositories, no shared transaction. The ordering is what makes that safe:
   * the money state settles FIRST and is durable, so the survivable failure is
   * "line `triggered`, no record" (visible, and fixable by recording again)
   * rather than "record written, line still attemptable", which would read as
   * refunded while leaving the buyer refundable a second time.
   */
  refundRecordIntent: ReturnRefundRecordIntent | null;
  /** The source's own words, where it said anything. */
  providerMessage: string | null;
}

export interface RecordRefundObservationInput {
  /**
   * What the source was OBSERVED to have done. Only these two: `refunded` is a
   * settlement and `denied` is a terminal rejection, and no other value is an
   * observation — `triggered` is what OL records about its own act, not about
   * the source's.
   */
  observedState: Extract<ReturnMoneyState, 'refunded' | 'denied'>;
  /**
   * **The SOURCE's own instant.** Required for `refunded`; a caller without one
   * gets `ReturnRefundObservationInvalidError` rather than OL's clock standing
   * in for a channel-reported fact (#2336/#2367).
   */
  observedAt?: Date | null;
  actorUserId?: string | null;
}

export interface IReturnRefundService {
  /**
   * Trigger a refund for a return.
   *
   * @throws {ReturnNotFoundError} the id resolves to no row.
   * @throws {ReturnNotAttributedError} the return is an orphan — a refund
   *   against a phantom order moves real money (#2332's ONE seam).
   * @throws {ReturnRefundContendedError} another attempt holds the lock.
   *   Retryable; nothing was changed and the executor was never reached.
   * @throws {ReturnRefundBlockedError} the money states permit no fresh
   *   attempt. Carries the closed reason, so the refusal names its cause.
   */
  triggerRefund(returnId: string, input: TriggerRefundInput): Promise<TriggerRefundResult>;

  /**
   * Record what the source was observed to do — the ONLY path to `refunded`,
   * and the only way an `in_doubt` line is ever resolved.
   *
   * `in_doubt` never auto-retries: OL does not know whether the money moved, and
   * guessing in either direction is unrecoverable. Only a terminal `denied`
   * re-permits an attempt (the ADR-042 discipline, by name).
   *
   * @throws {ReturnNotFoundError} the id resolves to no row.
   * @throws {ReturnRefundObservationInvalidError} a `refunded` observation with
   *   no source instant.
   */
  recordRefundObservation(
    returnId: string,
    input: RecordRefundObservationInput
  ): Promise<ReturnRecord>;
}
