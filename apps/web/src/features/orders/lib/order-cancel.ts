/**
 * Order cancel copy and rules (#3541, mockup M1)
 *
 * Everything about cancelling an order that is not a component: the closed
 * reason vocabulary with its labels (words in the `orders` namespace), the refusal codes the backend
 * answers with (read off `ApiError.details.error`, the `order-hold-errors.ts`
 * precedent), and the pure rules deciding whether the action is offered.
 *
 * **The server's stated reason is always rendered.** A 409 body carries both a
 * machine code and a message naming WHY (the carrier's own refusal for a label
 * that cannot be voided, the receipt provider to ask for a fiscal receipt). The
 * code picks the layout and the remedy; the message is the reason and is never
 * replaced by a generic sentence.
 *
 * @module apps/web/src/features/orders/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { getMessages, interpolate } from '../../../shared/i18n';
import {
  OrderCancelReasonValues,
  type CancelCorrectionUnavailableReason,
  type CancelParticipantEffect,
  type OrderCancelReason,
} from '../api/order-cancel.types';

export { OrderCancelReasonValues };
export type { OrderCancelReason };

export const ORDER_CANCEL_NOTE_MAX_LENGTH = 2000;

/** Whether the reason needs operator text. Mirrors the backend's `other` rule. */
export function orderCancelReasonRequiresNote(reason: OrderCancelReason): boolean {
  return reason === 'other';
}

/**
 * The label for a reason code (D37; `fraud` reads as a payment problem), or the
 * raw code for one this build does not know.
 */
export function orderCancelReasonLabel(reason: string): string {
  const labels = getMessages('orders').orderCancel.reasons;
  return Object.prototype.hasOwnProperty.call(labels, reason)
    ? labels[reason as OrderCancelReason]
    : reason;
}

/** Order statuses and phases after which cancelling is not an operator action. */
const TERMINAL_ORDER_STATUSES: readonly string[] = ['cancelled', 'delivered', 'refunded'];
const TERMINAL_ORDER_PHASES: readonly string[] = ['cancelled', 'delivered'];

export interface OrderCancellabilityInput {
  /** `orderSnapshot.status`. */
  snapshotStatus: string | undefined;
  /** The derived lifecycle phase. */
  lifecyclePhase: string | undefined;
  /** The shipment rollup state. */
  fulfillmentState: string | undefined;
}

/**
 * Whether the order is already in a terminal state, so the action is not shown.
 *
 * A DISPATCHED order is deliberately NOT terminal here: the mockup keeps the
 * button and answers `ORDER_ALREADY_SHIPPED` with the returns pointer, because a
 * hidden button would leave the operator with no explanation of why a parcel
 * on its way cannot be cancelled.
 */
export function isOrderCancelTerminal(input: OrderCancellabilityInput): boolean {
  return (
    (input.snapshotStatus !== undefined && TERMINAL_ORDER_STATUSES.includes(input.snapshotStatus)) ||
    (input.lifecyclePhase !== undefined && TERMINAL_ORDER_PHASES.includes(input.lifecyclePhase)) ||
    input.fulfillmentState === 'delivered'
  );
}

/** Mirrors the backend's "work a holder already took" test (`order-cancellation.service`). */
export function hasAcceptedFulfilmentWork(
  works: readonly { status: string; requestStatus: string }[],
): boolean {
  return works.some(
    (work) =>
      (work.status === 'in_progress' || work.requestStatus === 'accepted') &&
      work.status !== 'cancelled' &&
      work.status !== 'closed' &&
      work.status !== 'incomplete',
  );
}

export const ORDER_CANCEL_ERROR_CODES = [
  'ORDER_ALREADY_CANCELLED',
  'ORDER_ALREADY_SHIPPED',
  'ORDER_HAS_FISCAL_RECEIPT',
  'INVOICE_NOT_SETTLED',
  'ORDER_CANCEL_IN_FLIGHT',
  'ORDER_WORK_ACCEPTED_NEEDS_ACK',
  'ORDER_CANCEL_CONTENDED',
  'LABEL_NOT_VOIDABLE',
  'CHANNEL_REFUSED_CANCEL',
  'CHANGE_ALREADY_CONFIRMED',
  'CHANGE_EXPIRED',
  'CHANGE_NOT_OPEN',
  'CHANGE_KIND_NOT_CONFIRMABLE',
  'CORRECTION_IN_PROGRESS',
  'CORRECTION_NEEDS_RECONCILIATION',
  'CORRECTION_FAILED',
  'CORRECTION_SUPERSEDED',
] as const;
export type OrderCancelErrorCode = (typeof ORDER_CANCEL_ERROR_CODES)[number];

/**
 * The backend's machine code off an error body, restricted to `codes`, or null.
 * One reader for every order write (cancel, confirm, edit): each states its own
 * closed list, the body shape (`error` carries the code) is the same.
 */
export function readErrorCodeFrom<T extends string>(
  error: unknown,
  codes: readonly T[],
): T | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null) return null;
  const code = (details as { error?: unknown }).error;
  return typeof code === 'string' && (codes as readonly string[]).includes(code)
    ? (code as T)
    : null;
}

/** The backend's machine code off an error body, or null for anything else. */
export function readOrderCancelErrorCode(error: unknown): OrderCancelErrorCode | null {
  return readErrorCodeFrom(error, ORDER_CANCEL_ERROR_CODES);
}

/** The server's own sentence, or the fallback when the error carries none. */
export function readServerReason(error: unknown, fallback: string): string {
  return (error instanceof Error && error.message) || fallback;
}

/** Which layout a failed cancel renders in the dialog. */
export type OrderCancelRefusalView =
  | 'label' // cancel-label: a bought label the carrier will not void
  | 'shipped' // cancel-shipped: hard refusal pointing to returns
  | 'needs-ack' // the soft gate: tick the box and resubmit
  | 'inline'; // everything else: the server's reason in an Alert on the form

export function classifyOrderCancelError(error: unknown): OrderCancelRefusalView {
  switch (readOrderCancelErrorCode(error)) {
    case 'LABEL_NOT_VOIDABLE':
      return 'label';
    case 'ORDER_ALREADY_SHIPPED':
      return 'shipped';
    case 'ORDER_WORK_ACCEPTED_NEEDS_ACK':
      return 'needs-ack';
    default:
      return 'inline';
  }
}

/**
 * Title for an inline refusal, or undefined for a code with none. The body of
 * the Alert is always the server's sentence; the title says which kind of
 * refusal it is, because two 409s can have different remedies and a status
 * alone cannot tell them apart.
 */
export function orderCancelInlineTitle(code: OrderCancelErrorCode): string | undefined {
  const titles = getMessages('orders').orderCancel.inlineTitles;
  return Object.prototype.hasOwnProperty.call(titles, code)
    ? titles[code as keyof typeof titles]
    : undefined;
}

/** Whether a refusal means this page is out of date and should re-read the order. */
export function orderCancelErrorNeedsRefresh(error: unknown): boolean {
  const code = readOrderCancelErrorCode(error);
  return (
    code === 'ORDER_ALREADY_CANCELLED' ||
    code === 'ORDER_CANCEL_IN_FLIGHT' ||
    code === 'CHANNEL_REFUSED_CANCEL' ||
    code === 'ORDER_ALREADY_SHIPPED'
  );
}

const CANCEL_PARTICIPANT_EFFECT_TONES: Record<
  CancelParticipantEffect,
  'success' | 'info' | 'warning' | 'error'
> = {
  notified: 'success',
  'stock-restored-only': 'warning',
  'not-supported': 'warning',
  unreachable: 'error',
  refused: 'error',
};

/** One label and sentence per participant effect, for the result notice. */
export function cancelParticipantEffectCopy(effect: CancelParticipantEffect): {
  label: string;
  tone: 'success' | 'info' | 'warning' | 'error';
  description: string;
} {
  const words = getMessages('orders').orderCancel.participantEffects[effect];
  return { label: words.label, tone: CANCEL_PARTICIPANT_EFFECT_TONES[effect], description: words.description };
}

/** Why a cancel's correction invoice could not be drafted, in operator words. */
export function cancelCorrectionUnavailableText(reason: CancelCorrectionUnavailableReason): string {
  return getMessages('orders').orderCancel.correctionUnavailable[reason];
}

/** Operator title for a reason a correction confirm can fail, beside the server's sentence. */
export function confirmCorrectionErrorTitle(code: OrderCancelErrorCode): string | undefined {
  const titles = getMessages('orders').orderCancel.confirmCorrectionErrors;
  return Object.prototype.hasOwnProperty.call(titles, code)
    ? titles[code as keyof typeof titles]
    : undefined;
}

/** The figures a `refund_ceiling_exceeded` 409 carries. */
export interface RefundCeilingFigures {
  ceiling: string;
  alreadyRefunded: string;
  requested: string;
  currency: string;
}

/**
 * Read the ceiling refusal off a refund error, or null for any other failure.
 * Keyed on the body's `code` (the backend states it separately from `error`),
 * never on the message.
 */
export function readRefundCeilingFigures(error: unknown): RefundCeilingFigures | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null) return null;
  const body = details as Record<string, unknown>;
  if (body.code !== 'refund_ceiling_exceeded') return null;
  const text = (value: unknown): string =>
    typeof value === 'number' || typeof value === 'string' ? String(value) : '?';
  return {
    ceiling: text(body.ceiling),
    alreadyRefunded: text(body.alreadyRefunded),
    requested: text(body.requested),
    currency: typeof body.currency === 'string' ? body.currency : '',
  };
}

/**
 * What can still be refunded: the server's `ceiling` is the order's TOTAL, not
 * what is left, so the remainder is the total minus what was already refunded
 * (E-42). Falls back to the total when either figure is not a plain decimal.
 */
export function remainingRefundable(ceiling: string, alreadyRefunded: string): string {
  const total = Number(ceiling);
  const refunded = Number(alreadyRefunded);
  if (!Number.isFinite(total) || !Number.isFinite(refunded)) return ceiling;
  return Math.max(0, Math.round(total * 100) / 100 - Math.round(refunded * 100) / 100).toFixed(2);
}

/** Why a change row was abandoned by OpenLinker (the backend's `declinedReason`). */
export function abandonReasonCopy(
  reason: string | null,
  documentNumber: string | null,
): { title: string; description: string } | null {
  const copy = getMessages('orders').orderCancel.abandon;
  if (reason === 'label-not-voidable') {
    return { title: copy.labelNotVoidable.title, description: copy.labelNotVoidable.description };
  }
  if (reason === 'correction-superseded') {
    return {
      title: interpolate(copy.correctionSuperseded.title, {
        document: documentNumber ?? copy.correctionSuperseded.documentFallback,
      }),
      description: copy.correctionSuperseded.description,
    };
  }
  return null;
}
