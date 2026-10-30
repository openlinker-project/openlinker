/**
 * Order Edit Service Interface (#3542)
 *
 * @module apps/api/src/orders/application/interfaces
 */
import type { OrderRecord } from '@openlinker/core/orders';

import type {
  EditOrderAddressInput,
  EditOrderDeliveryMethodInput,
  EditOrderDiscountInput,
  EditOrderLinesInput,
  OrderEditResult,
  OrderEditsView,
} from '../types/order-edit.types';

export const ORDER_EDIT_SERVICE_TOKEN = Symbol('IOrderEditService');

export interface IOrderEditService {
  /**
   * Change the shipping address in OpenLinker (D9). Refused once a label is
   * bought, once the order is packed, and wherever the new address could not
   * reach whoever holds the work. Throws `OrderEditRefusedError` (409, with a
   * code) for every modelled refusal.
   */
  editAddress(input: EditOrderAddressInput): Promise<OrderEditResult>;

  /**
   * Lower line quantities. They can only go down. On a routed order the work
   * object is narrowed (units cancelled, `totalQuantity` untouched), the
   * reservation is lowered, and the product master is given its stock back.
   */
  editLines(input: EditOrderLinesInput): Promise<OrderEditResult>;

  /** Change the delivery method (and pickup point). */
  editDeliveryMethod(input: EditOrderDeliveryMethodInput): Promise<OrderEditResult>;

  /**
   * Grant (or replace, or remove) an order-level discount (#3543, D10). A money
   * event: it never rewrites the channel's prices. Unpaid / COD it lowers the
   * amount to collect; paid it opens a refund intent for the difference
   * (`order.discount_refund`, bounded by the #3289 ceiling); an issued invoice
   * gets a correction proposal (`order.discount_correction`). Throws
   * `RefundCeilingExceededException` (409 `refund_ceiling_exceeded`) for an
   * unacknowledged excess and `OrderEditRefusedError` for everything else.
   */
  editDiscount(input: EditOrderDiscountInput): Promise<OrderEditResult>;

  /**
   * The order beside the channel's own record of it, or `null` when nobody has
   * edited it. Costs no query for an unedited order.
   */
  getEditsView(record: OrderRecord): Promise<OrderEditsView | null>;
}
