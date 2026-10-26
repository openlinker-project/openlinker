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
  OrderEditedTotals,
  OrderOperatorEditKind,
  OrderPickupPoint,
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
  readonly cod: { readonly channelAmount: string; readonly amount: string | null; readonly currency: string } | null;
  readonly history: readonly OrderEditHistoryEntry[];
}

export interface OrderEditResult {
  readonly dryRun: boolean;
  /** `null` for a dry run. */
  readonly changeId: string | null;
  readonly view: OrderEditsView;
  /** Lines edit only: per lowered line, whether the product master was given its stock back. */
  readonly stock: readonly OrderEditLineStock[];
}
