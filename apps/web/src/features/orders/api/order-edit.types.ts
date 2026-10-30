/**
 * Order edit wire types (#3544)
 *
 * Hand-mirrored from the request / response DTOs in
 * `apps/api/src/orders/http/dto/{edit-order-request,order-edit-response}.dto.ts`
 * and the `OrderEditsView` the order detail read carries, per the FE-001
 * contract strategy - the browser cannot import `@openlinker/core` (#591).
 *
 * Every figure is given twice by the server (what the channel reported and what
 * the order is after the edit), so no surface here computes either. Money that
 * crosses as a string (discounts, COD, refund intents) stays a string.
 *
 * @module apps/web/src/features/orders/api
 */

/** An order address as the edit endpoints and the `edits` view carry it. */
export interface OrderEditAddress {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  address1: string;
  address2?: string | null;
  city: string;
  state?: string | null;
  postalCode: string;
  country: string;
  phone?: string | null;
}

// ---- requests -------------------------------------------------------------

/** `POST /orders/:id/edits/address`. `dryRun` returns the would-be view without saving. */
export interface EditOrderAddressRequest {
  dryRun?: boolean;
  firstName?: string;
  lastName?: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export interface EditOrderLineRequest {
  orderLineId: string;
  /** The new TOTAL quantity. Can only be lower than it is now; 0 removes the line. */
  quantity: number;
}

/** `POST /orders/:id/edits/lines`. */
export interface EditOrderLinesRequest {
  dryRun?: boolean;
  lines: EditOrderLineRequest[];
  acknowledgeAcceptedWork?: boolean;
}

/** `POST /orders/:id/edits/delivery-method`. Omit `pickupPoint` to clear it. */
export interface EditOrderDeliveryMethodRequest {
  dryRun?: boolean;
  methodId: string;
  methodName?: string;
  pickupPoint?: { id: string; name?: string; description?: string };
}

/** `POST /orders/:id/edits/discount`. Exactly one of `amount` / `percent`; `"0"` removes. */
export interface EditOrderDiscountRequest {
  dryRun?: boolean;
  amount?: string;
  percent?: number;
  acknowledgeAboveCeiling?: boolean;
}

// ---- views ----------------------------------------------------------------

export const OrderEditHistoryKindValues = [
  'order.address_change',
  'order.line_quantity_change',
  'order.delivery_method_change',
  'order.discount_change',
] as const;
export type OrderEditHistoryKind = (typeof OrderEditHistoryKindValues)[number];

export interface OrderEditHistoryEntry {
  changeId: string;
  /** Raw kind; read through `isOrderEditHistoryKind`, an unknown one is still shown. */
  kind: string;
  at: string;
  byUserId: string | null;
  /** Always true today: no channel supports these edits. */
  channelKeeps: boolean;
  channelConnectionId: string;
}

export interface OrderEditsLineView {
  orderLineId: string;
  /** What the channel reported. */
  channelQuantity: number;
  /** What the order says after the edit. */
  quantity: number;
}

export interface OrderEditedTotals {
  currency: string;
  /** What the buyer paid on the channel. */
  channelTotal: number;
  /** The order total after the edit. */
  total: number;
  difference: number;
  /** The channel's own whole-order discount; null = none reported. Absent on an older payload (E-44). */
  channelDiscountTotal?: number | null;
  /** Channel + OpenLinker discount; null only when neither exists. Absent on an older payload (E-44). */
  combinedDiscountTotal?: number | null;
  taxRestated: false;
}

export interface OrderDiscountView {
  /** Decimal string at the currency's minor unit. */
  amount: string;
  currency: string;
  perLine: { orderItemId: string; amount: string }[];
  changeId: string;
  editedAt: string;
  editedBy: string | null;
}

export const OrderDiscountProposalKindValues = [
  'order.discount_refund',
  'order.discount_correction',
] as const;
export type OrderDiscountProposalKind = (typeof OrderDiscountProposalKindValues)[number];

/** An open discount consequence waiting for the operator (confirm via the changes route). */
export interface OrderDiscountProposalEntry {
  changeId: string;
  kind: OrderDiscountProposalKind;
  status: string;
  requestedAt: string;
  currency: string;
  /** Refund intents: the amount to refund. */
  amount: string | null;
  /** Corrections: the document being corrected. */
  invoiceRecordId: string | null;
  /** Corrections: the document's number, as persisted when the proposal was drafted. */
  documentNumber: string | null;
  /** Corrections: the repriced lines as persisted, so a reload still shows them. */
  lines: DiscountCorrectionLine[] | null;
}

/** The order beside the channel's own record of it. `null` on an order nobody edited. */
export interface OrderEditsView {
  editedAt: string;
  address: { original: OrderEditAddress | null; current: OrderEditAddress } | null;
  /** Only the lowered lines. */
  lines: OrderEditsLineView[];
  deliveryMethod: {
    original: { id: string | null; name: string | null };
    current: { id: string; name: string | null };
  } | null;
  totals: OrderEditedTotals | null;
  discount: OrderDiscountView | null;
  discountProposals: OrderDiscountProposalEntry[];
  cod: { channelAmount: string; amount: string | null; currency: string } | null;
  history: OrderEditHistoryEntry[];
  /**
   * Quantity edits whose line the channel no longer reports: the edit no longer
   * applies and needs an operator's attention. Absent on an older payload.
   */
  unmatchedLineEdits?: OrderEditUnmatchedLineEdit[];
}

export interface OrderEditUnmatchedLineEdit {
  orderLineId: string;
  editedQuantity: number;
  editedAt: string;
}

export interface OrderEditLineStock {
  orderLineId: string;
  stockRestored: boolean | 'not-applicable';
  detail: string | null;
}

/** Result of the address / lines / delivery-method edits (and their dry runs). */
export interface OrderEditResult {
  dryRun: boolean;
  /** `null` for a dry run. */
  changeId: string | null;
  view: OrderEditsView;
  stock: OrderEditLineStock[];
}

export const DiscountPaymentBranchValues = ['paid', 'cod', 'unpaid', 'unknown'] as const;
export type DiscountPaymentBranch = (typeof DiscountPaymentBranchValues)[number];

export type DiscountRefundCeiling =
  | {
      status: 'within' | 'exceeded';
      ceiling: string;
      alreadyRefunded: string;
      requested: string;
      currency: string;
    }
  | { status: 'unknown'; reason: string };

export interface DiscountRefundIntent {
  changeId: string | null;
  amount: string;
  currency: string;
  ceiling: DiscountRefundCeiling;
}

export interface DiscountCorrectionLine {
  originalLineNumber: number;
  name: string;
  previousUnitPriceGross: number;
  newUnitPriceGross: number;
}

export interface DiscountCorrectionProposal {
  changeId: string | null;
  invoiceRecordId: string;
  documentNumber: string | null;
  currency: string;
  lines: DiscountCorrectionLine[];
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

/** Result of the discount edit (and its dry run): the money consequence is the point (D10). */
export interface OrderDiscountResult {
  dryRun: boolean;
  changeId: string | null;
  /** The current discount, `null` once removed. */
  discount: OrderDiscountView | null;
  totals: {
    currency: string;
    channelTotal: number;
    total: number;
    difference: number;
    channelDiscountTotal?: number | null;
    combinedDiscountTotal?: number | null;
  } | null;
  paymentBranch: DiscountPaymentBranch;
  /** Unpaid / COD: what is still to collect. `null` on a paid order. */
  amountToCollect: { amount: string; currency: string } | null;
  /** Paid: the refund the seller makes on the channel. */
  refundIntent: DiscountRefundIntent | null;
  refundIntentFailed: boolean;
  correctionProposal: DiscountCorrectionProposal | null;
  correctionUnavailableReason: DiscountCorrectionUnavailableReason | null;
  view: OrderEditsView;
}

/** The four edit endpoints, as one discriminated request. */
export type OrderEditRequest =
  | { kind: 'address'; body: EditOrderAddressRequest }
  | { kind: 'lines'; body: EditOrderLinesRequest }
  | { kind: 'delivery-method'; body: EditOrderDeliveryMethodRequest }
  | { kind: 'discount'; body: EditOrderDiscountRequest };

/** `POST /orders/:id/changes/:changeId/confirm` body. Optional for every kind but a discount refund. */
export interface ConfirmOrderChangeRequest {
  acknowledgeAboveCeiling?: boolean;
}
