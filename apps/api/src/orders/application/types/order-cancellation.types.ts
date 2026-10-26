/**
 * Order Cancellation Types (#3540)
 *
 * Request and result shapes of the operator-initiated order cancel and of the
 * confirm step for the credit proposal it leaves behind. Result types carry
 * CODES and facts only; operator copy is the frontend's.
 *
 * @module apps/api/src/orders/application/types
 */
import type { OrderCancelReason } from '@openlinker/core/orders';

export interface CancelOrderInput {
  readonly internalOrderId: string;
  readonly reason: OrderCancelReason;
  /** Operator free text. Required when `reason` is `other`; never relayed to a channel. */
  readonly note: string | null;
  /** The operator accepts that work a holder already took is cancelled underneath it. */
  readonly acknowledgeAcceptedWork: boolean;
  readonly actorUserId: string;
}

/**
 * What a participant's cancel writeback amounted to, from the operator's side.
 *
 * - `notified`            - the participant's own system now carries the cancel.
 * - `stock-restored-only` - OpenLinker restored stock but the channel has no
 *   confirmed cancel call (Erli), so the order stays open there.
 * - `not-supported`       - the participant cannot express a cancel; nothing was sent.
 * - `unreachable`         - the participant could not be reached (disabled /
 *   re-auth); retrying later may succeed.
 * - `refused`             - the participant refused.
 */
export const CancelParticipantEffectValues = [
  'notified',
  'stock-restored-only',
  'not-supported',
  'unreachable',
  'refused',
] as const;
export type CancelParticipantEffect = (typeof CancelParticipantEffectValues)[number];

export interface CancelParticipantOutcome {
  readonly connectionId: string;
  readonly role: 'source' | 'destination';
  readonly effect: CancelParticipantEffect;
  readonly detail: string | null;
}

/** One line of the credit proposal, as the confirm dialog shows it. */
export interface CancelCorrectionProposalLine {
  readonly originalLineNumber: number;
  readonly name: string;
  readonly previousQuantity: number;
  readonly newQuantity: number;
}

export interface CancelCorrectionProposal {
  readonly changeId: string;
  readonly invoiceRecordId: string;
  readonly documentNumber: string | null;
  readonly currency: string;
  readonly lines: readonly CancelCorrectionProposalLine[];
}

/** Why an invoiced order's credit proposal could not be built; the cancel still stands. */
export const CancelCorrectionUnavailableReasonValues = [
  'no-line-snapshot',
  'not-fully-issued',
  'proposal-failed',
] as const;
export type CancelCorrectionUnavailableReason =
  (typeof CancelCorrectionUnavailableReasonValues)[number];

export interface CancelOrderResult {
  /** `cancelled`: applied. `pending`: the channel's answer is unknown; the request stays open. */
  readonly status: 'cancelled' | 'pending';
  readonly changeId: string;
  readonly cancelledAt: Date | null;
  readonly participants: readonly CancelParticipantOutcome[];
  /** The destination participants could not be told (the relay itself failed). */
  readonly otherParticipantsRelayFailed: boolean;
  readonly voidedShipmentIds: readonly string[];
  readonly cancelledWorkIds: readonly string[];
  readonly stockRestoreEnqueued: boolean;
  readonly correctionProposal: CancelCorrectionProposal | null;
  readonly correctionUnavailableReason: CancelCorrectionUnavailableReason | null;
}

export interface ConfirmOrderChangeInput {
  readonly internalOrderId: string;
  readonly changeId: string;
  readonly actorUserId: string;
}

export interface ConfirmOrderChangeResult {
  readonly changeId: string;
  readonly kind: string;
  readonly status: 'confirmed';
  readonly invoiceRecordId: string;
  readonly invoiceStatus: string;
  readonly documentNumber: string | null;
}
