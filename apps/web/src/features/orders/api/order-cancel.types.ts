/**
 * Order cancel wire types (#3541)
 *
 * Hand-mirrored from `OrderCancelReasonValues` (`@openlinker/core/orders`) and the
 * cancel / confirm response DTOs in `apps/api/src/orders/http/dto` per the
 * FE-001 contract strategy - the browser cannot import `@openlinker/core` (#591).
 * Keep the value arrays in the same order as the backend's.
 *
 * Every field the backend sends is a CODE or a fact; the operator copy that
 * turns one into a sentence lives in `lib/order-cancel.ts`.
 *
 * @module apps/web/src/features/orders/api
 */

export const OrderCancelReasonValues = [
  'buyer-request',
  'out-of-stock',
  'fraud',
  'duplicate',
  'other',
] as const;
export type OrderCancelReason = (typeof OrderCancelReasonValues)[number];

/** `POST /orders/:internalOrderId/cancel` body. The actor is stamped server-side. */
export interface CancelOrderRequest {
  reason: OrderCancelReason;
  /** Operator free text, kept on the audit record. Required when `reason` is `other`. */
  note?: string;
  /** The operator accepts that work a holder already took is cancelled underneath it. */
  acknowledgeAcceptedWork?: boolean;
}

export const CancelParticipantEffectValues = [
  'notified',
  'stock-restored-only',
  'not-supported',
  'unreachable',
  'refused',
] as const;
export type CancelParticipantEffect = (typeof CancelParticipantEffectValues)[number];

export interface CancelParticipantOutcome {
  connectionId: string;
  role: 'source' | 'destination';
  effect: CancelParticipantEffect;
  detail: string | null;
}

export interface CancelCorrectionProposalLine {
  originalLineNumber: number;
  name: string;
  previousQuantity: number;
  newQuantity: number;
}

export interface CancelCorrectionProposal {
  changeId: string;
  invoiceRecordId: string;
  documentNumber: string | null;
  currency: string;
  lines: CancelCorrectionProposalLine[];
}

export const CancelCorrectionUnavailableReasonValues = [
  'no-line-snapshot',
  'not-fully-issued',
  'proposal-failed',
] as const;
export type CancelCorrectionUnavailableReason =
  (typeof CancelCorrectionUnavailableReasonValues)[number];

/**
 * `POST /orders/:internalOrderId/cancel` result. HTTP 200 carries `cancelled`;
 * HTTP 202 carries `pending` (the channel has not answered, the request stays
 * open and the order reads `amending`).
 */
export interface CancelOrderResult {
  status: 'cancelled' | 'pending';
  changeId: string;
  cancelledAt: string | null;
  participants: CancelParticipantOutcome[];
  otherParticipantsRelayFailed: boolean;
  voidedShipmentIds: string[];
  cancelledWorkIds: string[];
  stockRestoreEnqueued: boolean;
  correctionProposal: CancelCorrectionProposal | null;
  correctionUnavailableReason: CancelCorrectionUnavailableReason | null;
}

/** `POST /orders/:internalOrderId/changes/:changeId/confirm` result. */
export interface ConfirmOrderChangeResult {
  changeId: string;
  kind: string;
  status: 'confirmed';
  invoiceRecordId: string;
  invoiceStatus: string;
  documentNumber: string | null;
}

export const OrderChangeKindValues = ['order.cancel_request', 'order.cancel_correction'] as const;
export type OrderChangeKind = (typeof OrderChangeKindValues)[number];

/**
 * One row of `GET /orders/:internalOrderId/changes` (#3540): what an operator
 * asked of the order and the credit proposal it left, newest first. This read is
 * what lets a reloaded page, or a second admin, find a pending cancel and the
 * correction awaiting confirmation.
 */
export interface OrderChangeView {
  id: string;
  kind: OrderChangeKind;
  /** Raw status: pending | requested | confirmed | declined | canceled | expired. */
  status: string;
  /** Still open under the lazy-expiry TTL. Read this, not `status`, for "waiting". */
  open: boolean;
  requestedAt: string;
  confirmedAt: string | null;
  declinedReason: string | null;
  payload: {
    cancelRequest: { reason: string; note: string | null } | null;
    correction: {
      invoiceRecordId: string;
      documentNumber: string | null;
      currency: string;
      lines: CancelCorrectionProposalLine[];
    } | null;
  };
}
