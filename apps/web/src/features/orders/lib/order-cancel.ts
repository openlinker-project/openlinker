/**
 * Order cancel copy and rules (#3541, mockup M1)
 *
 * Everything operator-facing about cancelling an order that is not a component:
 * the closed reason vocabulary with its labels, the refusal codes the backend
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
import {
  OrderCancelReasonValues,
  type CancelCorrectionUnavailableReason,
  type CancelParticipantEffect,
  type OrderCancelReason,
} from '../api/order-cancel.types';

export { OrderCancelReasonValues };
export type { OrderCancelReason };

/** Labels for the closed reason set (D37). `fraud` reads as a payment problem. */
export const ORDER_CANCEL_REASON_LABELS: Record<OrderCancelReason, string> = {
  'buyer-request': 'Buyer asked to cancel',
  'out-of-stock': 'Out of stock',
  fraud: 'Suspected fraud or payment problem',
  duplicate: 'Duplicate order',
  other: 'Other',
};

export const ORDER_CANCEL_NOTE_MAX_LENGTH = 2000;

/** Whether the reason needs operator text. Mirrors the backend's `other` rule. */
export function orderCancelReasonRequiresNote(reason: OrderCancelReason): boolean {
  return reason === 'other';
}

/** The label for a reason code, or the raw code for one this build does not know. */
export function orderCancelReasonLabel(reason: string): string {
  return (ORDER_CANCEL_REASON_LABELS as Record<string, string>)[reason] ?? reason;
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
 * Titles for the inline refusals. The body of the Alert is always the server's
 * sentence; the title says which kind of refusal it is, because two 409s can
 * have different remedies and a status alone cannot tell them apart.
 */
export const ORDER_CANCEL_INLINE_TITLES: Partial<Record<OrderCancelErrorCode, string>> = {
  ORDER_ALREADY_CANCELLED: 'This order is already cancelled',
  ORDER_HAS_FISCAL_RECEIPT: 'A fiscal receipt blocks the cancel',
  INVOICE_NOT_SETTLED: 'The invoice has not finished issuing',
  ORDER_CANCEL_IN_FLIGHT: 'A cancellation is already in progress',
  ORDER_CANCEL_CONTENDED: 'Someone else is cancelling this order right now',
  CHANNEL_REFUSED_CANCEL: 'The sales channel refused the cancellation',
};

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

/** One sentence per participant effect, for the result notice. */
export const CANCEL_PARTICIPANT_EFFECT_COPY: Record<
  CancelParticipantEffect,
  { label: string; tone: 'success' | 'info' | 'warning' | 'error'; description: string }
> = {
  notified: {
    label: 'Cancelled there',
    tone: 'success',
    description: 'The cancellation was sent and accepted.',
  },
  'stock-restored-only': {
    label: 'Stock restored only',
    tone: 'warning',
    description:
      'This channel has no confirmed cancel call. OpenLinker restored the stock, but the order stays open there until you cancel it.',
  },
  'not-supported': {
    label: 'Not supported',
    tone: 'warning',
    description: 'This system cannot express a cancellation, so nothing was sent.',
  },
  unreachable: {
    label: 'Could not reach',
    tone: 'error',
    description: 'The connection could not be reached. Cancel the order there by hand.',
  },
  refused: {
    label: 'Refused',
    tone: 'error',
    description: 'The channel refused the cancellation. Cancel the order there by hand.',
  },
};

export const CANCEL_CORRECTION_UNAVAILABLE_COPY: Record<CancelCorrectionUnavailableReason, string> = {
  'no-line-snapshot':
    'OpenLinker holds no record of the lines on the original invoice, so it cannot draft a correction. Issue the correction from the invoice panel.',
  'not-fully-issued':
    'The invoice has not finished issuing, so it cannot be corrected yet. Issue the correction once it settles.',
  'proposal-failed':
    'OpenLinker could not draft the correction invoice. Issue the correction from the invoice panel.',
};

/** Operator copy for each reason a correction confirm can fail, beside the server's sentence. */
export const CONFIRM_CORRECTION_ERROR_TITLES: Partial<Record<OrderCancelErrorCode, string>> = {
  CHANGE_ALREADY_CONFIRMED: 'This correction was already confirmed',
  CHANGE_EXPIRED: 'This correction proposal expired',
  CHANGE_NOT_OPEN: 'This correction proposal is no longer open',
  CHANGE_KIND_NOT_CONFIRMABLE: 'This change cannot be confirmed from here',
  CORRECTION_IN_PROGRESS: 'The correction is already being issued',
  CORRECTION_NEEDS_RECONCILIATION: 'The correction needs checking at the provider',
  CORRECTION_FAILED: 'The invoicing provider rejected the correction',
  CORRECTION_SUPERSEDED: 'The invoice was already corrected, or the order was cancelled',
};

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

/** Why a change row was abandoned by OpenLinker (the backend's `declinedReason`). */
export function abandonReasonCopy(
  reason: string | null,
  documentNumber: string | null,
): { title: string; description: string } | null {
  if (reason === 'label-not-voidable') {
    return {
      title: 'Cancelled request: the carrier would not void the label',
      description: 'The order was not cancelled. Void the label with the carrier, then cancel the order again.',
    };
  }
  if (reason === 'correction-superseded') {
    return {
      title: `Correction no longer needed: ${documentNumber ?? 'a document'} already corrected the invoice`,
      description: 'The invoice was corrected by another document, so this proposal was closed.',
    };
  }
  return null;
}
