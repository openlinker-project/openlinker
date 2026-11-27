/**
 * Order edit copy and rules (#3544, mockup M1 `edit-*`)
 *
 * Everything about editing an order that is not a component: the
 * refusal codes the edit endpoints answer with (read off `ApiError.details.error`
 * through the same reader the cancel flow uses), the remedy each one points at,
 * which section of the form a refusal locks, the discount's money copy and the
 * pure rules that mirror the server's as a convenience.
 *
 * **The server's stated reason is always rendered**, the `order-cancel.ts` rule:
 * the code picks the layout and the remedy, the message is the reason. The copy
 * here is the FALLBACK for a refusal the page predicted before any call.
 *
 * **Nothing here computes a figure.** Both totals ("paid on the channel" and
 * "after the edit"), the discount's refund and the amount to collect all arrive
 * from the server; this module formats and words them.
 *
 * @module apps/web/src/features/orders/lib
 */
import type {
  DiscountCorrectionUnavailableReason,
  DiscountPaymentBranch,
  DiscountRefundCeiling,
  OrderEditHistoryEntry,
  OrderEditLineStock,
} from '../api/order-edit.types';
import { formatPlural, getLocale, getMessages, interpolate } from '../../../shared/i18n';
import { readErrorCodeFrom, remainingRefundable } from './order-cancel';

export const ORDER_EDIT_ERROR_CODES = [
  'ORDER_ALREADY_CANCELLED',
  'ORDER_ALREADY_SHIPPED',
  'ORDER_AMENDMENT_IN_FLIGHT',
  'ORDER_NOT_READY',
  'ORDER_PACKED',
  'LABEL_ALREADY_BOUGHT',
  'SALES_DOCUMENT_ISSUED',
  'QUANTITY_ONLY_DECREASES',
  'QUANTITY_BELOW_FULFILLED',
  'ORDER_WOULD_BE_EMPTY',
  'EDIT_AFTER_HANDOFF',
  'ORDER_WORK_ACCEPTED_NEEDS_ACK',
  'ADDRESS_EDIT_NEEDS_PII_STORAGE',
  'ORDER_EDIT_CONTENDED',
  'NOTHING_CHANGED',
  'DISCOUNT_EXCEEDS_TOTAL',
  'ORDER_HAS_FISCAL_RECEIPT',
  'INVOICE_NOT_SETTLED',
  'LINE_PRICE_NOT_RESOLVABLE',
  'DISCOUNT_BELOW_REFUNDED',
] as const;
export type OrderEditErrorCode = (typeof ORDER_EDIT_ERROR_CODES)[number];

/** The backend's machine code off an edit refusal, or null for anything else. */
export function readOrderEditErrorCode(error: unknown): OrderEditErrorCode | null {
  return readErrorCodeFrom(error, ORDER_EDIT_ERROR_CODES);
}

/** The four sections of the edit form, each submitted to its own endpoint. */
export const OrderEditSectionValues = ['address', 'delivery', 'lines', 'discount'] as const;
export type OrderEditSection = (typeof OrderEditSectionValues)[number];

/** The operator-facing name of an edit section, in the active language. */
export function orderEditSectionLabel(section: OrderEditSection): string {
  return getMessages('orders').orderEdit.sections[section];
}

/** Which layout a failed edit renders in. */
export type OrderEditRefusalView =
  | 'blocked' // edit-blocked: the order is in a state that refuses the edit; reason + remedy
  | 'needs-ack' // the soft gate: tick the box and resubmit
  | 'ceiling' // a discount past the refund ceiling: the figures and a tick-to-proceed
  | 'inline'; // a problem with what was typed: the server's reason on the form

const BLOCKED_CODES: readonly OrderEditErrorCode[] = [
  'ORDER_ALREADY_CANCELLED',
  'ORDER_ALREADY_SHIPPED',
  'ORDER_AMENDMENT_IN_FLIGHT',
  'ORDER_NOT_READY',
  'ORDER_PACKED',
  'LABEL_ALREADY_BOUGHT',
  'SALES_DOCUMENT_ISSUED',
  'EDIT_AFTER_HANDOFF',
  'ADDRESS_EDIT_NEEDS_PII_STORAGE',
  'ORDER_HAS_FISCAL_RECEIPT',
  'INVOICE_NOT_SETTLED',
  'LINE_PRICE_NOT_RESOLVABLE',
  'DISCOUNT_BELOW_REFUNDED',
];

export function classifyOrderEditRefusal(code: OrderEditErrorCode | null): OrderEditRefusalView {
  if (code === 'ORDER_WORK_ACCEPTED_NEEDS_ACK') return 'needs-ack';
  if (code !== null && BLOCKED_CODES.includes(code)) return 'blocked';
  return 'inline';
}

/** Where on the page a refusal's remedy lives. The dialog closes and the page scrolls there. */
export type OrderEditRemedyTarget = 'packing' | 'shipment' | 'invoicing';

export interface OrderEditRefusalCopy {
  title: string;
  /** Used only when the error carries no sentence of its own (a refusal predicted by the page). */
  fallbackReason: string;
  /** Numbered steps. Empty when the only remedy is to wait or to change what was typed. */
  steps: readonly string[];
  /** The section(s) this refusal locks. */
  locks: readonly OrderEditSection[];
  /** The page control the remedy points at, when there is one. */
  remedy: { target: OrderEditRemedyTarget; label: string } | null;
}

const EVERY_SECTION: readonly OrderEditSection[] = OrderEditSectionValues;

interface OrderEditRefusalRule {
  locks: readonly OrderEditSection[];
  remedy: OrderEditRemedyTarget | null;
}

/** What each refusal locks and where its remedy lives. The words are in the `orders` namespace. */
const ORDER_EDIT_REFUSAL_RULES: Record<OrderEditErrorCode, OrderEditRefusalRule> = {
  ORDER_ALREADY_CANCELLED: { locks: EVERY_SECTION, remedy: null },
  // A discount is still allowed after shipping: it changes money, not the parcel.
  ORDER_ALREADY_SHIPPED: { locks: ['address', 'delivery', 'lines'], remedy: null },
  ORDER_AMENDMENT_IN_FLIGHT: { locks: EVERY_SECTION, remedy: null },
  ORDER_NOT_READY: { locks: EVERY_SECTION, remedy: null },
  ORDER_PACKED: { locks: EVERY_SECTION, remedy: 'packing' },
  LABEL_ALREADY_BOUGHT: { locks: ['address', 'delivery'], remedy: 'shipment' },
  SALES_DOCUMENT_ISSUED: { locks: ['lines'], remedy: 'invoicing' },
  ORDER_HAS_FISCAL_RECEIPT: { locks: ['discount'], remedy: 'invoicing' },
  INVOICE_NOT_SETTLED: { locks: ['discount'], remedy: 'invoicing' },
  LINE_PRICE_NOT_RESOLVABLE: { locks: ['lines'], remedy: null },
  DISCOUNT_BELOW_REFUNDED: { locks: ['discount'], remedy: null },
  EDIT_AFTER_HANDOFF: { locks: EVERY_SECTION, remedy: null },
  ADDRESS_EDIT_NEEDS_PII_STORAGE: { locks: ['address'], remedy: null },
  ORDER_WORK_ACCEPTED_NEEDS_ACK: { locks: [], remedy: null },
  QUANTITY_ONLY_DECREASES: { locks: [], remedy: null },
  QUANTITY_BELOW_FULFILLED: { locks: [], remedy: null },
  ORDER_WOULD_BE_EMPTY: { locks: [], remedy: null },
  ORDER_EDIT_CONTENDED: { locks: [], remedy: null },
  NOTHING_CHANGED: { locks: [], remedy: null },
  DISCOUNT_EXCEEDS_TOTAL: { locks: [], remedy: null },
};

interface RefusalWords {
  title: string;
  fallbackReason: string;
  steps?: Readonly<Record<string, string>>;
}

/** The refusal's words (active language) beside what it locks and where its remedy lives. */
export function orderEditRefusalCopy(code: OrderEditErrorCode): OrderEditRefusalCopy {
  const copy = getMessages('orders').orderEdit;
  const words = copy.refusals[code] as RefusalWords;
  const rule = ORDER_EDIT_REFUSAL_RULES[code];
  return {
    title: words.title,
    fallbackReason: words.fallbackReason,
    // Keys are "1", "2", ...: sorted so the numbered steps keep their order.
    steps: Object.keys(words.steps ?? {})
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => (words.steps ?? {})[key]),
    locks: rule.locks,
    remedy:
      rule.remedy === null ? null : { target: rule.remedy, label: copy.remedies[rule.remedy] },
  };
}

/** Whether a refusal means this page is out of date and should re-read the order. */
export function orderEditErrorNeedsRefresh(code: OrderEditErrorCode | null): boolean {
  return (
    code === 'ORDER_ALREADY_CANCELLED' ||
    code === 'ORDER_ALREADY_SHIPPED' ||
    code === 'ORDER_AMENDMENT_IN_FLIGHT' ||
    code === 'ORDER_PACKED' ||
    code === 'ORDER_EDIT_CONTENDED'
  );
}

/** The sections locked by a refusal, as a set. An unknown or absent code locks nothing. */
export function lockedSectionsFor(
  code: OrderEditErrorCode | null,
  refusedSection: OrderEditSection | null = null
): ReadonlySet<OrderEditSection> {
  if (code === null) return new Set();
  const locks = ORDER_EDIT_REFUSAL_RULES[code].locks;
  // A refusal of a section the code does not normally lock (a discount refused
  // by a bought label) locks that section, not the sections the code is about.
  if (refusedSection !== null && !locks.includes(refusedSection)) {
    return new Set([refusedSection]);
  }
  return new Set(locks);
}

// ---- rules mirrored from the server, as a convenience ----------------------

const DECIMAL_AMOUNT = /^\d+(\.\d+)?$/;

/** A plain decimal such as `12.50`, the shape the discount endpoint accepts. */
export function isPlainDecimal(value: string): boolean {
  return DECIMAL_AMOUNT.test(value.trim());
}

export const ORDER_EDIT_DISCOUNT_MODES = ['amount', 'percent'] as const;
export type OrderEditDiscountMode = (typeof ORDER_EDIT_DISCOUNT_MODES)[number];

/** Whether the order keeps at least one unit once every line is lowered. */
export function keepsAnyUnit(quantities: readonly number[]): boolean {
  return quantities.some((quantity) => quantity > 0);
}

// ---- discount money copy (D10) ---------------------------------------------

/** One label per payment branch, for the review's money alert. */
export function discountBranchLabel(branch: DiscountPaymentBranch): string {
  return getMessages('orders').orderEdit.discountBranches[branch];
}

/** Why a discount's document correction could not be drafted, in operator words. */
export function discountCorrectionUnavailableText(
  reason: DiscountCorrectionUnavailableReason
): string {
  return getMessages('orders').orderEdit.correctionUnavailable[reason];
}

/**
 * What an edit's stock restore did, in operator words (E-52). A failed restore is
 * a `warning` and names the server's reason; `not-applicable` is stated rather
 * than hidden so silence never reads as "stock was put back".
 *
 * `list` joins the reasons in the active language (`useFormat().list`), so a
 * Polish sentence reads "a i b" rather than an English-style comma join.
 */
export function describeStockOutcome(
  stock: readonly OrderEditLineStock[],
  list: (items: readonly string[]) => string
): {
  tone: 'info' | 'warning';
  text: string;
} | null {
  if (stock.length === 0) return null;
  const copy = getMessages('orders').orderEdit.stock;
  const locale = getLocale();
  const failed = stock.filter((line) => line.stockRestored === false);
  if (failed.length > 0) {
    const reasons = Array.from(
      new Set(failed.map((line) => line.detail).filter((d): d is string => Boolean(d)))
    );
    return {
      tone: 'warning',
      text:
        reasons.length > 0
          ? formatPlural(failed.length, copy.notRestoredWithReasons, locale, {
              reasons: list(reasons),
            })
          : formatPlural(failed.length, copy.notRestored, locale),
    };
  }
  const restored = stock.filter((line) => line.stockRestored === true).length;
  if (restored > 0) {
    return { tone: 'info', text: formatPlural(restored, copy.restored, locale) };
  }
  return { tone: 'info', text: copy.unchanged };
}

/** The ceiling verdict as one operator sentence. */
export function describeCeilingVerdict(ceiling: DiscountRefundCeiling): {
  tone: 'info' | 'warning';
  text: string;
} {
  const copy = getMessages('orders').orderEdit.ceiling;
  if (ceiling.status === 'within') {
    return {
      tone: 'info',
      text: interpolate(copy.within, {
        remaining: formatDecimalAmount(
          remainingRefundable(ceiling.ceiling, ceiling.alreadyRefunded),
          ceiling.currency
        ),
      }),
    };
  }
  if (ceiling.status === 'exceeded') {
    return {
      tone: 'warning',
      text: interpolate(copy.exceeded, {
        requested: formatDecimalAmount(ceiling.requested, ceiling.currency),
        remaining: formatDecimalAmount(
          remainingRefundable(ceiling.ceiling, ceiling.alreadyRefunded),
          ceiling.currency
        ),
        refunded: formatDecimalAmount(ceiling.alreadyRefunded, ceiling.currency),
      }),
    };
  }
  return { tone: 'warning', text: copy.unknown };
}

// ---- timeline copy ---------------------------------------------------------

/** Each edit kind's key in the `orderEdit.history` copy. */
const ORDER_EDIT_HISTORY_KEYS = {
  'order.address_change': 'addressChange',
  'order.line_quantity_change': 'lineQuantityChange',
  'order.delivery_method_change': 'deliveryMethodChange',
  'order.discount_change': 'discountChange',
  'order.gift_added': 'giftAdded',
} as const;

export function orderEditHistoryTitle(entry: OrderEditHistoryEntry): string {
  const copy = getMessages('orders').orderEdit.history;
  return Object.prototype.hasOwnProperty.call(ORDER_EDIT_HISTORY_KEYS, entry.kind)
    ? copy[ORDER_EDIT_HISTORY_KEYS[entry.kind as keyof typeof ORDER_EDIT_HISTORY_KEYS]]
    : copy.fallback;
}

/** `"12.50 PLN"`: a server decimal string beside its currency. */
export function formatDecimalAmount(amount: string, currency: string): string {
  return currency ? `${amount} ${currency}` : amount;
}
