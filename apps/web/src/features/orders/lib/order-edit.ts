/**
 * Order edit copy and rules (#3544, mockup M1 `edit-*`)
 *
 * Everything operator-facing about editing an order that is not a component: the
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

export const ORDER_EDIT_SECTION_LABELS: Record<OrderEditSection, string> = {
  address: 'Shipping address',
  delivery: 'Delivery method',
  lines: 'Items',
  discount: 'Discount',
};

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

export const ORDER_EDIT_REFUSAL_COPY: Record<OrderEditErrorCode, OrderEditRefusalCopy> = {
  ORDER_ALREADY_CANCELLED: {
    title: 'This order is cancelled',
    fallbackReason: 'A cancelled order cannot be edited.',
    steps: [],
    locks: EVERY_SECTION,
    remedy: null,
  },
  ORDER_ALREADY_SHIPPED: {
    title: 'The parcel is on its way',
    fallbackReason:
      'This order has already shipped, so its address, delivery method and items can no longer be changed. A discount still can.',
    steps: ['When the parcel comes back, use the returns flow.'],
    // A discount is still allowed after shipping: it changes money, not the parcel.
    locks: ['address', 'delivery', 'lines'],
    remedy: null,
  },
  ORDER_AMENDMENT_IN_FLIGHT: {
    title: 'A cancellation is waiting for the channel',
    fallbackReason: 'A cancellation of this order is waiting for the sales channel to answer.',
    steps: ['Wait for the channel to answer, then edit the order.'],
    locks: EVERY_SECTION,
    remedy: null,
  },
  ORDER_NOT_READY: {
    title: 'This order has not finished importing',
    fallbackReason: 'Its products are not matched yet.',
    steps: ['Fix the product mapping, then edit the order.'],
    locks: EVERY_SECTION,
    remedy: null,
  },
  ORDER_PACKED: {
    title: 'This order is already packed',
    fallbackReason: 'Unpack it first, so the box is opened again, then edit it.',
    steps: ['Mark the order as not packed.', 'Edit the order.'],
    locks: EVERY_SECTION,
    remedy: { target: 'packing', label: 'Go to Packing' },
  },
  LABEL_ALREADY_BOUGHT: {
    title: 'A shipping label is already bought',
    fallbackReason: 'The label carries the current address and method.',
    steps: ['Cancel the shipment. This voids its label with the carrier.', 'Edit the order.'],
    locks: ['address', 'delivery'],
    remedy: { target: 'shipment', label: 'Go to shipment' },
  },
  SALES_DOCUMENT_ISSUED: {
    title: 'Items can’t be changed',
    fallbackReason: 'A sales document is already issued for this order.',
    steps: ['Issue a correction from Sales document on this page.'],
    locks: ['lines'],
    remedy: { target: 'invoicing', label: 'Go to Sales document' },
  },
  ORDER_HAS_FISCAL_RECEIPT: {
    title: 'A fiscal receipt blocks the discount',
    fallbackReason: 'A fiscal receipt cannot be corrected by OpenLinker.',
    steps: ['Correct the receipt at the register or the receipt provider.'],
    locks: ['discount'],
    remedy: { target: 'invoicing', label: 'Go to Sales document' },
  },
  INVOICE_NOT_SETTLED: {
    title: 'The invoice has not finished issuing',
    fallbackReason: 'It cannot be corrected until it settles.',
    steps: ['Wait for the invoice to finish issuing, then add the discount.'],
    locks: ['discount'],
    remedy: { target: 'invoicing', label: 'Go to Sales document' },
  },
  LINE_PRICE_NOT_RESOLVABLE: {
    title: 'Items can’t be changed',
    fallbackReason: 'OpenLinker can not work out this line’s gross price, so it can not lower it.',
    steps: ['Cancel the order and ask the buyer to order again.'],
    locks: ['lines'],
    remedy: null,
  },
  DISCOUNT_BELOW_REFUNDED: {
    title: 'The discount is lower than what was refunded',
    fallbackReason: 'A discount refund was already confirmed, so the discount can not go below it.',
    steps: [],
    locks: ['discount'],
    remedy: null,
  },
  EDIT_AFTER_HANDOFF: {
    title: 'The order is with an outside warehouse',
    fallbackReason: 'The warehouse cannot be told about the change.',
    steps: ['Ask the warehouse to change it, or cancel the order and route it again.'],
    locks: EVERY_SECTION,
    remedy: null,
  },
  ADDRESS_EDIT_NEEDS_PII_STORAGE: {
    title: 'The address can’t be edited here',
    fallbackReason: 'OpenLinker is set not to store buyer addresses.',
    steps: [],
    locks: ['address'],
    remedy: null,
  },
  ORDER_WORK_ACCEPTED_NEEDS_ACK: {
    title: 'This order is on the pack bench',
    fallbackReason: 'Someone has started picking it.',
    steps: [],
    locks: [],
    remedy: null,
  },
  QUANTITY_ONLY_DECREASES: {
    title: 'A quantity can only go down',
    fallbackReason: 'Raising a quantity would be a new sale. Ask the buyer to order again.',
    steps: [],
    locks: [],
    remedy: null,
  },
  QUANTITY_BELOW_FULFILLED: {
    title: 'That is fewer than already shipped',
    fallbackReason: 'Some units of this line are already fulfilled.',
    steps: [],
    locks: [],
    remedy: null,
  },
  ORDER_WOULD_BE_EMPTY: {
    title: 'An order needs at least one item',
    fallbackReason: 'To remove everything, cancel the order instead.',
    steps: [],
    locks: [],
    remedy: null,
  },
  ORDER_EDIT_CONTENDED: {
    title: 'Someone else is editing this order',
    fallbackReason: 'Try again in a moment.',
    steps: [],
    locks: [],
    remedy: null,
  },
  NOTHING_CHANGED: {
    title: 'Nothing to change',
    fallbackReason: 'That is already how the order is.',
    steps: [],
    locks: [],
    remedy: null,
  },
  DISCOUNT_EXCEEDS_TOTAL: {
    title: 'The discount is more than the order',
    fallbackReason: 'A discount can not take the order below zero.',
    steps: [],
    locks: [],
    remedy: null,
  },
};

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
  refusedSection: OrderEditSection | null = null,
): ReadonlySet<OrderEditSection> {
  if (code === null) return new Set();
  const locks = ORDER_EDIT_REFUSAL_COPY[code].locks;
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
export const DISCOUNT_BRANCH_LABELS: Record<DiscountPaymentBranch, string> = {
  paid: 'The buyer already paid',
  cod: 'Cash on delivery',
  unpaid: 'Not paid yet',
  unknown: 'Payment status unknown',
};

export const DISCOUNT_CORRECTION_UNAVAILABLE_COPY: Record<
  DiscountCorrectionUnavailableReason,
  string
> = {
  'fiscal-receipt':
    'A fiscal receipt was registered for this order. OpenLinker can not correct it, so correct it where it was registered.',
  'no-line-snapshot':
    'OpenLinker holds no record of the lines on the issued invoice, so it cannot draft a correction. Issue the correction from the invoice panel.',
  'not-fully-issued':
    'The invoice has not finished issuing, so it cannot be corrected yet. Issue the correction once it settles.',
  'unmatched-lines':
    'The invoice lines could not be matched to the order, so OpenLinker cannot draft a correction. Issue it from the invoice panel.',
  'proposal-failed':
    'OpenLinker could not draft the correction. Issue the correction from the invoice panel.',
};

/**
 * What an edit's stock restore did, in operator words (E-52). A failed restore is
 * a `warning` and names the server's reason; `not-applicable` is stated rather
 * than hidden so silence never reads as "stock was put back".
 */
export function describeStockOutcome(stock: readonly OrderEditLineStock[]): {
  tone: 'info' | 'warning';
  text: string;
} | null {
  if (stock.length === 0) return null;
  const failed = stock.filter((line) => line.stockRestored === false);
  if (failed.length > 0) {
    const reasons = Array.from(
      new Set(failed.map((line) => line.detail).filter((d): d is string => Boolean(d))),
    );
    return {
      tone: 'warning',
      text: `Stock was not put back for ${failed.length === 1 ? 'one line' : `${failed.length} lines`}${
        reasons.length > 0 ? ` (${reasons.join(', ')})` : ''
      }. OpenLinker will try again.`,
    };
  }
  const restored = stock.filter((line) => line.stockRestored === true).length;
  if (restored > 0) {
    return {
      tone: 'info',
      text: `Stock was put back for ${restored === 1 ? 'one line' : `${restored} lines`}.`,
    };
  }
  return { tone: 'info', text: 'Stock was not changed: nothing needed putting back for this order.' };
}

/** The ceiling verdict as one operator sentence. */
export function describeCeilingVerdict(ceiling: DiscountRefundCeiling): {
  tone: 'info' | 'warning';
  text: string;
} {
  if (ceiling.status === 'within') {
    return {
      tone: 'info',
      text: `Within what can still be refunded on this order (${remainingRefundable(ceiling.ceiling, ceiling.alreadyRefunded)} ${ceiling.currency} left).`,
    };
  }
  if (ceiling.status === 'exceeded') {
    return {
      tone: 'warning',
      text: `More than can still be refunded on this order: ${ceiling.requested} ${ceiling.currency} requested, ${remainingRefundable(ceiling.ceiling, ceiling.alreadyRefunded)} ${ceiling.currency} left after ${ceiling.alreadyRefunded} ${ceiling.currency} already refunded.`,
    };
  }
  return {
    tone: 'warning',
    text: 'OpenLinker could not check how much can still be refunded on this order.',
  };
}

// ---- timeline copy ---------------------------------------------------------

export const ORDER_EDIT_HISTORY_TITLES: Record<string, string> = {
  'order.address_change': 'Shipping address changed',
  'order.line_quantity_change': 'Item quantities lowered',
  'order.delivery_method_change': 'Delivery method changed',
  'order.discount_change': 'Discount changed',
};

export function orderEditHistoryTitle(entry: OrderEditHistoryEntry): string {
  return ORDER_EDIT_HISTORY_TITLES[entry.kind] ?? 'Order edited';
}

/** `"12.50 PLN"`: a server decimal string beside its currency. */
export function formatDecimalAmount(amount: string, currency: string): string {
  return currency ? `${amount} ${currency}` : amount;
}
