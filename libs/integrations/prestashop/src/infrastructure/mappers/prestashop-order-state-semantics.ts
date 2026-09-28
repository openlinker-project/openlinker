/**
 * PrestaShop Order-State Semantics
 *
 * Pure rules for reading what one `ps_order_state` row MEANS, so no code path
 * has to know an id.
 *
 * PrestaShop order-state ids are shop data, not protocol. A merchant renames
 * states, deletes them, adds "Awaiting courier pickup" and "Sent to
 * accounting", and an id that means "Canceled" on a clean install means
 * something else on the shop next door. The adapter used to carry the
 * default-install table 1-7 and read every custom state as `pending`, silently
 * (#2607).
 *
 * The state row itself carries PrestaShop's own answer. `delivered`, `shipped`
 * and `paid` are the flags PrestaShop uses internally to decide whether to show
 * a tracking link or send a shipped email, so they are as authoritative as
 * anything the WebService exposes, and they are the same in every language.
 *
 * Cancellation and refund have no flag of their own - `ps_order_state` has no
 * such column, and PrestaShop identifies those states through configuration
 * keys instead. So they are read from the state's own labels, across every
 * language the row carries.
 *
 * Reading labels is the weak half, and two rules keep it honest (#2607 review).
 *
 * A stem matches the START of ONE WORD of the label, never a fragment anywhere
 * in the string, and every stem is at least `MIN_STEM_LENGTH` characters. The
 * previous rule matched four-character fragments anywhere, so `abge` matched
 * the German "Abgeschlossen" (completed) and "Abgesendet" (sent) and read a
 * finished order as cancelled. Where a language prefixes the word family -
 * Dutch "Geannuleerd", German "Rückerstattet" - the prefixed form is its own
 * entry rather than relaxing the rule for everybody, because a stem allowed to
 * match mid-word matches unrelated words too ("Granulat" contains `anulat`).
 *
 * A label that matches nothing does not go quiet. `deriveOrderState` reports
 * `basis: 'no-evidence'` for it, and the catalogue names every such state once
 * per read. On a clean install those are the awaiting states, where `pending`
 * is the right answer; on a shop in a language this vocabulary does not cover
 * they may include the cancellation or refund state, and then `pending` is a
 * false statement about money that nobody could previously see.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 */
import type { OrderStatus, PaymentStatus } from '@openlinker/core/orders';
import { PAYMENT_STATUS } from '@openlinker/core/orders';

import type { PrestashopOrderState } from '../../domain/types/prestashop-options.types';

const TRUE_VALUES: ReadonlySet<string> = new Set(['1', 'true']);

/**
 * Shortest stem allowed in either vocabulary below.
 *
 * Five is where the false positives stopped in practice: `abge` (4) matched two
 * unrelated German states, while `storn` and `annul` (5) start no word a shop
 * would use for something else. Asserted by the spec, so a shorter stem cannot
 * be added quietly.
 */
export const MIN_STEM_LENGTH = 5;

/**
 * Cancellation vocabulary, one entry per word family rather than per language,
 * with diacritics already folded away (`annulé` is matched by `annul`).
 *
 * `reject` is deliberately here: a state named "Payment rejected" will not
 * ship, which is what a cancellation means to every reader of this value, and
 * no default-install state carries the word.
 *
 * Non-Latin scripts (EL, RU, UK, BG, HE, AR, ZH, JA, KO) and a few short Latin
 * words (Turkish "İade", Vietnamese "Hủy") are a known gap: they are shorter
 * than one word family can safely be, or written in a script this rule cannot
 * stem. A shop in one of those languages sees the `no-evidence` report.
 */
const CANCEL_STEMS: readonly string[] = [
  'cancel', // en, es, pt
  'annul', // fr, it, tr
  'geannul', // nl
  'anulow', // pl
  'anulat', // ro
  'anulad', // es
  'anulir', // hr, sr, sl
  'storn', // de, cs, sk
  'abgebroch', // de
  'avbrut', // sv
  'avbryt', // no
  'peruut', // fi
  'zrusen', // cs, sk
  'iptal', // tr
  'dibatalk', // id
  'reject', // en
];

/**
 * Refund vocabulary, same rules and the same documented gap. Checked after
 * cancellation, and never before the flags: a state can be both refunded and
 * shipped, and where the parcel is comes first.
 */
const REFUND_STEMS: readonly string[] = [
  'refund', // en, da, no, hr, sr
  'rembours', // fr
  'reembols', // es, pt
  'rimbors', // it
  'erstatt', // de
  'ruckerstatt', // de "Rückerstattet"
  'zwroc', // pl "Zwrócono"
  'zwrot', // pl "Zwrot"
  'terugbetaa', // nl
  'vracen', // cs
  'vraten', // sk
  'aterbetal', // sv "Återbetald"
  'hyvite', // fi
  'rambursa', // ro
  'visszater', // hu
  'grazint', // lt
  'atmaksa', // lv
];

/**
 * How `deriveOrderState` reached its answer.
 *
 * `no-evidence` is the one value a caller must act on: nothing about the state
 * said anything, so `pending` is a default rather than a reading.
 */
export const ORDER_STATE_DERIVATION_BASIS_VALUES = [
  'delivered-flag',
  'shipped-flag',
  'cancel-label',
  'refund-label',
  'paid-flag',
  'no-evidence',
] as const;

export type OrderStateDerivationBasis = (typeof ORDER_STATE_DERIVATION_BASIS_VALUES)[number];

export interface OrderStateDerivation {
  status: OrderStatus;
  basis: OrderStateDerivationBasis;
}

/**
 * True for PrestaShop's `'1'` / `1` / `'true'` flag spellings.
 */
export function isTruthyStateFlag(value: string | number | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return TRUE_VALUES.has(String(value));
}

/**
 * Every label a state row carries.
 *
 * `name` is a flat string on a single-language install and the multi-language
 * shape (`{ language: [{ '#text': … }] }`) otherwise. All labels are read, so a
 * multilingual shop does not depend on which language happens to come first.
 */
export function extractOrderStateLabels(name: PrestashopOrderState['name']): readonly string[] {
  if (typeof name === 'string') {
    return [name];
  }
  if (name === null || name === undefined || typeof name !== 'object') {
    return [];
  }

  const language = (name as Record<string, unknown>)['language'];
  const labels: string[] = [];

  if (Array.isArray(language)) {
    for (const entry of language) {
      const label = extractTextLabel(entry);
      if (label !== null) {
        labels.push(label);
      }
    }
  } else if (language !== null && typeof language === 'object') {
    const label = extractTextLabel(language);
    if (label !== null) {
      labels.push(label);
    }
  }

  return labels;
}

/**
 * True when any of the state's labels reads as a cancellation.
 */
export function isCancelledOrderState(state: PrestashopOrderState): boolean {
  return labelMatchesAnyStem(state, CANCEL_STEMS);
}

/**
 * True when any of the state's labels reads as a refund.
 */
export function isRefundedOrderState(state: PrestashopOrderState): boolean {
  return labelMatchesAnyStem(state, REFUND_STEMS);
}

/**
 * Derive the neutral order status one state row stands for, with the evidence
 * that produced it.
 *
 * Order of the tests is the point. `delivered` and `shipped` come first because
 * they are the shop's own flags and beat any label reading. `paid` alone is
 * `processing`: money has arrived and nothing has left the warehouse.
 */
export function deriveOrderState(state: PrestashopOrderState): OrderStateDerivation {
  if (isTruthyStateFlag(state.delivered)) {
    return { status: 'delivered', basis: 'delivered-flag' };
  }
  if (isTruthyStateFlag(state.shipped)) {
    return { status: 'shipped', basis: 'shipped-flag' };
  }
  if (isCancelledOrderState(state)) {
    return { status: 'cancelled', basis: 'cancel-label' };
  }
  if (isRefundedOrderState(state)) {
    return { status: 'refunded', basis: 'refund-label' };
  }
  if (isTruthyStateFlag(state.paid)) {
    return { status: 'processing', basis: 'paid-flag' };
  }
  return { status: 'pending', basis: 'no-evidence' };
}

/**
 * The neutral status alone, for the callers that only route on it.
 */
export function deriveOrderStatusFromState(state: PrestashopOrderState): OrderStatus {
  return deriveOrderState(state).status;
}

/**
 * What this state says about the MONEY, read from the same row.
 *
 * ## Why this exists
 *
 * `PrestashopOrderSourceAdapter` reported no `paymentStatus` at all, and on a
 * connection whose `triggerModel` is `auto-on-paid` the gate reads exactly that
 * field (`order.paymentStatus === 'paid'`). So every PrestaShop order was
 * `waiting` for ever: no invoice, no receipt, no warehouse release, and
 * therefore no stock movement either - silently, with no block reason, because
 * "not paid yet" is legitimately not a block. Measured on the demo stack:
 * 150 PrestaShop orders, 18 WooCommerce, 28 Subiekt, every one of them with a
 * null payment status, against 95 Allegro orders reading `paid`.
 *
 * ## It is derived INDEPENDENTLY of the status, not from it
 *
 * `deriveOrderState` puts `delivered` and `shipped` first because those flags
 * beat everything for a STATUS. They must not do so here: a cash-on-delivery
 * parcel ships and is delivered while still unpaid, so inferring payment from
 * shipment would report money the seller has not received.
 *
 * ## It reports `'paid'` or NOTHING, and the silence is the load-bearing part
 *
 * A first version of this returned `'awaiting'` when the flag was clear, on the
 * reasoning that PrestaShop's own `paid = 0` is evidence rather than an
 * inference. That reasoning is sound about the shop and wrong about
 * OpenLinker, because of what reads the value downstream:
 *
 *   - `DISPATCH_BLOCKING_PAYMENT_STATUSES` holds `awaiting` and `refunded`, so
 *     either one REFUSES a label with a 422;
 *   - the label form hides its manual cash-on-delivery amount field for any
 *     status other than unknown or `cod`.
 *
 * Both were explicitly load-bearing on this source reporting NOTHING - the
 * policy's own docblock says "`undefined` (payment unknown - PrestaShop /
 * legacy orders) … PERMIT dispatch", and the form's says "sources that don't
 * report payment (PrestaShop / WooCommerce / DPD) keep the manual-COD path".
 *
 * And `ps_order_state` cannot express cash on delivery. It carries no such
 * flag; the payment method is free text on the ORDER, written by whichever
 * module handled it. So a shop sitting in the stock `Awaiting Cash On Delivery
 * validation` state - the ordinary Polish *za pobraniem* flow - would report
 * `'awaiting'`, and OpenLinker would refuse to ship it until it was paid,
 * while the buyer pays the courier on delivery. A deadlock with no escape
 * state, produced by a source telling the truth.
 *
 * The rule is therefore about the SOURCE's vocabulary rather than about the
 * gate: a source that cannot distinguish "unpaid, prepay expected" from
 * "unpaid, pays the courier" must not report a status that assumes the first.
 * `'paid'` is safe because it blocks nothing, and it is the only value the
 * auto-issue gate needs.
 *
 * `'refunded'` is withheld for the same reason and one more: it is read from a
 * LABEL, and the refund vocabulary matches word stems, so a shop state named
 * "Zwrot do nadawcy" (return to sender) would permanently refuse dispatch for
 * that order on a naming accident.
 */
export function derivePaymentStatusFromState(state: PrestashopOrderState): PaymentStatus | undefined {
  if (isRefundedOrderState(state)) {
    return undefined;
  }
  if (isTruthyStateFlag(state.paid)) {
    return PAYMENT_STATUS.Paid;
  }
  return undefined;
}

/**
 * Lowercase, diacritic-folded words of a label.
 *
 * Folding is what lets one stem serve "Annulé", "Annullato" and "Geannuleerd".
 * Splitting into words is what stops a stem spanning two of them.
 */
export function toLabelWords(label: string): readonly string[] {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

function labelMatchesAnyStem(state: PrestashopOrderState, stems: readonly string[]): boolean {
  for (const label of extractOrderStateLabels(state.name)) {
    for (const word of toLabelWords(label)) {
      if (stems.some((stem) => word.startsWith(stem))) {
        return true;
      }
    }
  }
  return false;
}

function extractTextLabel(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (value !== null && typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text'];
    if (typeof text === 'string') {
      return text;
    }
  }
  return null;
}

/** Exposed for the spec that pins the minimum-stem-length rule. */
export const ORDER_STATE_LABEL_STEMS: readonly string[] = [...CANCEL_STEMS, ...REFUND_STEMS];
