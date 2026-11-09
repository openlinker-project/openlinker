/**
 * Order form types
 *
 * The validation copy every order form schema is built with, and the value
 * shapes of the forms whose values are not inferred from their schema, in one
 * place so the schemas do not depend on one another for a type.
 *
 * @module apps/web/src/features/orders/components
 */
import type { Messages, ResolvedCopy } from '../../../shared/i18n';
import type { OrderEditRequest } from '../api/order-edit.types';
import type { BulkActionsCopy } from '../lib/bulk-order-actions.types';
import type { OrderEditDiscountMode, OrderEditSection } from '../lib/order-edit';

/** The `orders.cancelOrderDialog.validation` copy, in the language the form renders in. */
export type CancelOrderValidationCopy = ResolvedCopy<
  Messages['orders']
>['cancelOrderDialog']['validation'];

/** The `orders.bulkActions.cancel.validation` copy. */
export type BulkCancelValidationCopy = BulkActionsCopy['cancel']['validation'];

/** The `orders.holds.validation` copy, in the language the form renders in. */
export type HoldValidationCopy = ResolvedCopy<Messages['orders']>['holds']['validation'];

/** The `orders.generateLabelForm.validation` copy, in the language the form renders in. */
export type GenerateLabelValidationCopy = ResolvedCopy<
  Messages['orders']
>['generateLabelForm']['validation'];

/** The parcel rules read the single-order form's messages, so the two never drift. */
export type ParcelValidationCopy = Pick<
  GenerateLabelValidationCopy,
  'length' | 'width' | 'height' | 'weight'
>;

/** The `orders.orderEditDialog.validation` copy, in the language the form renders in. */
export type OrderEditValidationCopy = ResolvedCopy<
  Messages['orders']
>['orderEditDialog']['validation'];

export interface ReleaseOrderHoldFormValues {
  note?: string;
}

export interface OrderEditLineValue {
  orderLineId: string;
  quantity: string;
}

export interface OrderEditFormValues {
  firstName: string;
  lastName: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  methodId: string;
  methodName: string;
  pickupId: string;
  pickupName: string;
  lines: OrderEditLineValue[];
  discountMode: OrderEditDiscountMode;
  discountValue: string;
  acknowledgeAcceptedWork: boolean;
  acknowledgeAboveCeiling: boolean;
}

/** What the form was opened with, so a section's "changed" is a comparison and not a flag. */
export type OrderEditInitialValues = OrderEditFormValues;

/** Display data for the quantity table; not part of the submitted values. */
export interface OrderEditLineMeta {
  orderLineId: string;
  name: string | null;
  sku: string | null;
  /** The quantity the order has now: the ceiling the input may not pass. */
  maxQuantity: number;
  /** The channel's own quantity when it differs, for the "of N" caption. */
  channelQuantity: number;
}

/** One request per changed section, in the order they are sent: lines before the discount. */
export interface PlannedOrderEdit {
  section: OrderEditSection;
  edit: OrderEditRequest;
}
