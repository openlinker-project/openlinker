/**
 * Order Edit Types (#3542, D9)
 *
 * The request and result shapes of the operator's post-import order edits. The
 * view is what lets a surface show BOTH figures: what the channel reported and
 * what the order is after the edit.
 *
 * @module apps/api/src/orders/application/types
 */
import type {
  Address,
  OrderDiscountEdit,
  OrderEditedTotals,
  OrderOperatorEditKind,
  OrderPickupPoint,
  UnmatchedLineEdit,
} from '@openlinker/core/orders';

export interface EditOrderBase {
  readonly internalOrderId: string;
  readonly actorUserId: string | null;
  /** Validate every gate and return the would-be view, writing nothing (the `edit-review` state). */
  readonly dryRun: boolean;
}

export type EditOrderAddressInput = EditOrderBase & { readonly address: Address };

export interface EditOrderLinesInput extends EditOrderBase {
  readonly lines: ReadonlyArray<{ readonly orderLineId: string; readonly quantity: number }>;
  /** Lower a line whose fulfilment work a holder already accepted or started. */
  readonly acknowledgeAcceptedWork: boolean;
}

export interface EditOrderDeliveryMethodInput extends EditOrderBase {
  readonly methodId: string;
  readonly methodName: string | null;
  readonly pickupPoint: OrderPickupPoint | null;
}

export interface EditOrderDiscountInput extends EditOrderBase {
  /** Decimal string in the order currency. Exactly one of `amount` / `percent`. */
  readonly amount: string | null;
  /** Percent of the goods value, 0-100. Resolved to an amount at the currency's minor unit. */
  readonly percent: number | null;
  /** Let a refund intent that would pass the order's refund ceiling through (#3289). */
  readonly acknowledgeAboveCeiling: boolean;
}

/** What a discount does to money, by what the buyer has already done. */
export const DiscountPaymentBranchValues = ['paid', 'cod', 'unpaid', 'unknown'] as const;
export type DiscountPaymentBranch = (typeof DiscountPaymentBranchValues)[number];

export interface DiscountRefundIntent {
  /** `null` in a dry run. */
  readonly changeId: string | null;
  readonly amount: string;
  readonly currency: string;
  /** The #3289 verdict at creation: `within`, `exceeded` (acknowledged) or `unknown`. */
  readonly ceiling:
    | { readonly status: 'within' | 'exceeded'; readonly ceiling: string; readonly alreadyRefunded: string; readonly requested: string; readonly currency: string }
    | { readonly status: 'unknown'; readonly reason: string };
}

export interface DiscountCorrectionLine {
  readonly originalLineNumber: number;
  readonly name: string;
  readonly previousUnitPriceGross: number;
  readonly newUnitPriceGross: number;
}

export interface DiscountCorrectionProposal {
  /** `null` in a dry run. */
  readonly changeId: string | null;
  readonly invoiceRecordId: string;
  readonly documentNumber: string | null;
  readonly currency: string;
  readonly lines: readonly DiscountCorrectionLine[];
}

export const DiscountCorrectionUnavailableReasonValues = [
  'fiscal-receipt',
  'no-line-snapshot',
  'not-fully-issued',
  'unmatched-lines',
  'proposal-failed',
] as const;
export type DiscountCorrectionUnavailableReason =
  (typeof DiscountCorrectionUnavailableReasonValues)[number];

/** What the discount edit did beyond the overlay (#3543). */
export interface OrderDiscountOutcome {
  /** The current discount, or `null` once removed. */
  readonly discount: OrderDiscountEdit | null;
  readonly paymentBranch: DiscountPaymentBranch;
  /** Unpaid and cash-on-delivery orders: what is still to collect. `null` on a paid order. */
  readonly amountToCollect: { readonly amount: string; readonly currency: string } | null;
  readonly refundIntent: DiscountRefundIntent | null;
  /** The refund intent could not be opened after the discount was saved; the discount stands. */
  readonly refundIntentFailed: boolean;
  readonly correctionProposal: DiscountCorrectionProposal | null;
  readonly correctionUnavailableReason: DiscountCorrectionUnavailableReason | null;
}

/** What happened to the stock of one lowered line. */
export type LineStockRestored = true | false | 'not-applicable';

export interface OrderEditLineStock {
  readonly orderLineId: string;
  readonly stockRestored: LineStockRestored;
  /** Present when `stockRestored` is `false`: why the master did not take the give-back. */
  readonly detail: string | null;
}

export interface OrderEditsLineView {
  readonly orderLineId: string;
  readonly channelQuantity: number;
  readonly quantity: number;
}

export interface OrderEditHistoryEntry {
  readonly changeId: string;
  readonly kind: OrderOperatorEditKind;
  readonly at: string;
  readonly byUserId: string | null;
  /** Always `true` today: no channel supports any of these edits (D9). The FE words it. */
  readonly channelKeeps: true;
  readonly channelConnectionId: string;
}

export interface OrderDiscountProposalEntry {
  readonly changeId: string;
  readonly kind: 'order.discount_refund' | 'order.discount_correction';
  readonly status: string;
  readonly requestedAt: string;
  readonly currency: string;
  /** Refund intents: the amount to refund. */
  readonly amount: string | null;
  /** Corrections: the document being corrected. */
  readonly invoiceRecordId: string | null;
  /** Corrections: the document's number, as persisted when the proposal was drafted. */
  readonly documentNumber: string | null;
  /** Corrections: the repriced lines, as persisted, so a reloaded page can still show them. */
  readonly lines: readonly DiscountCorrectionLine[] | null;
}

/**
 * The order as the operator left it, beside the channel's own record of it.
 * `null` on an order nobody has edited.
 */
export interface OrderEditsView {
  readonly editedAt: string;
  readonly address: { readonly original: Address | null; readonly current: Address } | null;
  readonly lines: readonly OrderEditsLineView[];
  readonly deliveryMethod: {
    readonly original: { readonly id: string | null; readonly name: string | null };
    readonly current: { readonly id: string; readonly name: string | null };
  } | null;
  readonly totals: OrderEditedTotals | null;
  /** The current discount, `null` when none. */
  readonly discount: OrderDiscountEdit | null;
  /** Open `order.discount_refund` / `order.discount_correction` rows waiting for the operator. */
  readonly discountProposals: readonly OrderDiscountProposalEntry[];
  readonly cod: { readonly channelAmount: string; readonly amount: string | null; readonly currency: string } | null;
  readonly unmatchedLineEdits: readonly UnmatchedLineEdit[];
  readonly history: readonly OrderEditHistoryEntry[];
}

export interface OrderEditResult {
  readonly dryRun: boolean;
  /** `null` for a dry run. */
  readonly changeId: string | null;
  readonly view: OrderEditsView;
  /** Lines edit only: per lowered line, whether the product master was given its stock back. */
  readonly stock: readonly OrderEditLineStock[];
  /** Discount edits only (#3543). */
  readonly discount?: OrderDiscountOutcome;
}
