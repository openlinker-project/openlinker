/**
 * Payment Writeback (#3963)
 *
 * Per-destination record of whether a payment that arrived after an order was
 * created in a shop has reached that shop, plus the pure rule that decides,
 * on every ingestion, what to do for each destination.
 *
 * The record lives in `order_records.paymentWriteback`, keyed by destination
 * connection id, and is BOTH the operator-facing outcome and the at-most-once
 * claim: a destination moves to `sending` through one conditional UPDATE, so a
 * webhook and a poll ingesting the same payment cannot both write it. It is
 * per destination rather than one order-level marker so that one slow shop
 * never re-drives the others (the #861 all-or-nothing problem).
 *
 * The rule is LEVEL-triggered, never a "was unpaid, now paid" diff: the
 * snapshot is persisted before item resolution can throw, so a retried
 * ingestion would see `paid` already and a diff would never fire again. The
 * durable fact the rule keys on is instead the `awaiting` entry written when a
 * shop received the order unpaid.
 *
 * Pure rule beside its type (the `*.types.ts` pure-rule exception in
 * engineering-standards.md): no I/O, a function of its inputs alone.
 *
 * @module libs/core/src/orders/domain/types
 */
import { PAYMENT_METHOD, type PaymentMethod } from './payment-method.types';
import { PAYMENT_STATUS, type PaymentStatus } from './payment-status.types';

/**
 * - `awaiting`           - the shop got the order unpaid; a payment will be sent when it arrives.
 * - `sending`            - claimed by a writeback job (in flight).
 * - `paid-in-shop`       - the shop now shows the order as paid.
 * - `created-paid`       - the order was already paid when the shop got it; nothing to send.
 * - `retrying`           - the shop did not answer; the job retries on its own.
 * - `not-sent`           - nothing will be sent; `reason` says why.
 * - `cod`                - cash on delivery: never marked paid.
 * - `not-tracked`        - the shop has no payment status (e.g. Subiekt GT).
 * - `skipped-by-setting` - the connection is set to leave payment to the operator.
 * - `handled`            - an operator marked a `not-sent` entry as dealt with.
 */
export const PaymentWritebackStateValues = [
  'awaiting',
  'sending',
  'paid-in-shop',
  'created-paid',
  'retrying',
  'not-sent',
  'cod',
  'not-tracked',
  'skipped-by-setting',
  'handled',
] as const;
export type PaymentWritebackState = (typeof PaymentWritebackStateValues)[number];

/**
 * Why a `not-sent` entry was not sent. `cancelled` and `refunded` are
 * deliberate decisions, not failures; the other three are problems an
 * operator has to act on. `no-total` means OpenLinker does not know how much
 * the buyer paid, so it sends nothing rather than tell the shop "0 paid".
 */
export const PaymentWritebackReasonValues = [
  'cancelled',
  'refunded',
  'retries-exhausted',
  'rejected',
  'no-total',
] as const;
export type PaymentWritebackReason = (typeof PaymentWritebackReasonValues)[number];

export interface PaymentWritebackEntry {
  state: PaymentWritebackState;
  /** ISO instant of the last change to this entry. */
  at: string;
  /** Writeback attempts made so far (0 until the first send). */
  attempts: number;
  reason?: PaymentWritebackReason;
  /** Shop-provided detail for `rejected` / `retrying`; shown in Activity, never as a label. */
  detail?: string;
}

/** Keyed by destination connection id. */
export type PaymentWriteback = Readonly<Record<string, PaymentWritebackEntry>>;

/** States after which nothing else is ever sent for that destination. */
const SETTLED_STATES: ReadonlySet<PaymentWritebackState> = new Set<PaymentWritebackState>([
  'paid-in-shop',
  'created-paid',
  'not-sent',
  'cod',
  'not-tracked',
  'skipped-by-setting',
  'handled',
]);

const PROBLEM_REASONS: ReadonlySet<PaymentWritebackReason> = new Set<PaymentWritebackReason>([
  'retries-exhausted',
  'rejected',
  'no-total',
]);

function isState(value: unknown): value is PaymentWritebackState {
  return typeof value === 'string' && (PaymentWritebackStateValues as readonly string[]).includes(value);
}

function isReason(value: unknown): value is PaymentWritebackReason {
  return typeof value === 'string' && (PaymentWritebackReasonValues as readonly string[]).includes(value);
}

/**
 * Coerce the persisted jsonb column. An entry with an unknown state is dropped
 * rather than guessed at, so a value written by a newer build reads as "no
 * record" (the rule then treats it as never-provisioned, which sends nothing).
 */
export function readPaymentWriteback(raw: unknown): PaymentWriteback {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, PaymentWritebackEntry> = {};
  for (const [connectionId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (!isState(v.state)) continue;
    out[connectionId] = {
      state: v.state,
      at: typeof v.at === 'string' ? v.at : new Date(0).toISOString(),
      attempts: typeof v.attempts === 'number' && Number.isFinite(v.attempts) ? v.attempts : 0,
      ...(isReason(v.reason) ? { reason: v.reason } : {}),
      ...(typeof v.detail === 'string' ? { detail: v.detail } : {}),
    };
  }
  return out;
}

/** True when an operator has to act: the shop still shows unpaid and OpenLinker gave up. */
export function isPaymentWritebackProblem(entry: PaymentWritebackEntry): boolean {
  return entry.state === 'not-sent' && entry.reason !== undefined && PROBLEM_REASONS.has(entry.reason);
}

export function hasPaymentWritebackProblem(writeback: PaymentWriteback): boolean {
  return Object.values(writeback).some(isPaymentWritebackProblem);
}

/**
 * Cash on delivery is sticky: once either snapshot says so, the order is never
 * marked paid. PrestaShop and WooCommerce sources report `paid` after the
 * courier collected, which must not read as an online payment arriving.
 */
export function isCashOnDeliveryOrder(input: {
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  storedPaymentStatus?: PaymentStatus;
  storedPaymentMethod?: PaymentMethod;
}): boolean {
  return (
    input.paymentMethod === PAYMENT_METHOD.CashOnDelivery ||
    input.storedPaymentMethod === PAYMENT_METHOD.CashOnDelivery ||
    input.paymentStatus === PAYMENT_STATUS.Cod ||
    input.storedPaymentStatus === PAYMENT_STATUS.Cod
  );
}

export type PaymentWritebackMode = 'mark-paid' | 'leave';

export interface PaymentWritebackDestinationInput {
  connectionId: string;
  /** The order exists in this shop (a synced sync-status row). */
  synced: boolean;
  /** The shop received the order in THIS ingestion run. */
  createdNow: boolean;
  mode: PaymentWritebackMode;
}

export interface DecidePaymentWritebackInput {
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  /** Payment facts of the record BEFORE this ingestion; `undefined` when there was no record. */
  storedPaymentStatus?: PaymentStatus;
  storedPaymentMethod?: PaymentMethod;
  /** A record existed before this ingestion. */
  hadRecord: boolean;
  isCancelled: boolean;
  hasRefund: boolean;
  destinations: readonly PaymentWritebackDestinationInput[];
  existing: PaymentWriteback;
}

/**
 * The send-time half of the rule: given that a destination is waiting for a
 * payment, is anything now stopping the send? Shared by the ingestion-time
 * decision and the writeback job, which re-checks right before it writes
 * because an order can be cancelled or refunded between the two.
 * `null` means send.
 */
export function paymentWritebackBlock(input: {
  cod: boolean;
  isCancelled: boolean;
  hasRefund: boolean;
  mode: PaymentWritebackMode;
}): { state: PaymentWritebackState; reason?: PaymentWritebackReason } | null {
  if (input.cod) return { state: 'cod' };
  if (input.isCancelled) return { state: 'not-sent', reason: 'cancelled' };
  if (input.hasRefund) return { state: 'not-sent', reason: 'refunded' };
  if (input.mode === 'leave') return { state: 'skipped-by-setting' };
  return null;
}

export type PaymentWritebackDecision =
  | { connectionId: string; action: 'send' }
  | {
      connectionId: string;
      action: 'record';
      state: PaymentWritebackState;
      reason?: PaymentWritebackReason;
    };

/**
 * Decide, per destination, whether to record a state or to send the payment.
 * A destination absent from the result needs nothing.
 *
 * Order of the checks matters and each one is a deliberate refusal:
 * settled entries and in-flight ones are left alone; cash on delivery is
 * recorded once and never sent; an unpaid order only records `awaiting` for a
 * shop that just got it; a paid order that a shop got just now is
 * `created-paid` (today's behaviour, no extra write); a cancelled or refunded
 * order records why nothing was sent; the per-connection setting can opt out.
 */
export function decidePaymentWriteback(input: DecidePaymentWritebackInput): PaymentWritebackDecision[] {
  const decisions: PaymentWritebackDecision[] = [];
  const cod = isCashOnDeliveryOrder(input);
  const paid = input.paymentStatus === PAYMENT_STATUS.Paid;

  for (const dest of input.destinations) {
    if (!dest.synced) continue;
    const entry = input.existing[dest.connectionId];
    const state = entry?.state;

    if (state !== undefined && (SETTLED_STATES.has(state) || state === 'sending' || state === 'retrying')) {
      continue;
    }

    if (cod) {
      decisions.push({ connectionId: dest.connectionId, action: 'record', state: 'cod' });
      continue;
    }

    if (!paid) {
      if (state === undefined && dest.createdNow) {
        decisions.push({ connectionId: dest.connectionId, action: 'record', state: 'awaiting' });
      }
      continue;
    }

    if (state === undefined) {
      if (dest.createdNow) {
        decisions.push({ connectionId: dest.connectionId, action: 'record', state: 'created-paid' });
        continue;
      }
      // A shop provisioned before this feature existed has no entry. Treat it as
      // awaiting only when the previous record was positively not paid; a record
      // that was already paid (or no record at all) means the shop got it paid.
      const wasUnpaidBefore = input.hadRecord && input.storedPaymentStatus !== PAYMENT_STATUS.Paid;
      if (!wasUnpaidBefore) continue;
    }

    const block = paymentWritebackBlock({ ...input, cod: false, mode: dest.mode });
    decisions.push(
      block === null
        ? { connectionId: dest.connectionId, action: 'send' }
        : { connectionId: dest.connectionId, action: 'record', ...block }
    );
  }

  return decisions;
}
