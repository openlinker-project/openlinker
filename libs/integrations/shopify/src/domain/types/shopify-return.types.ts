/**
 * Shopify Return Types
 *
 * The slices of the Admin GraphQL `Return` object (API 2026-10) the return
 * feed and the return read select, and the decoded form of the return feed's
 * opaque cursor.
 *
 * @module libs/integrations/shopify/src/domain/types
 */
import type { ShopifyConnection, ShopifyMoneyBag } from './shopify-api.types';

/**
 * `ReturnStatus` values that mean the return is finished. Published to core as
 * `terminalRawStatuses` and used for the per-read `isTerminalAtSource` hint, so
 * the two cannot drift. `REQUESTED` and `OPEN` are the open ones.
 */
export const SHOPIFY_RETURN_TERMINAL_STATUSES: readonly string[] = ['CLOSED', 'DECLINED', 'CANCELED'];

/** One return as the feed lists it on an order: existence only, no lines. */
export interface ShopifyReturnFeedNode {
  readonly id: string;
  readonly name: string | null;
  readonly status: string;
  readonly createdAt: string | null;
}

/** An order on the return feed, with the returns it carries. */
export interface ShopifyReturnFeedOrderRow {
  readonly id: string;
  readonly returns: ShopifyConnection<ShopifyReturnFeedNode>;
}

/**
 * One returned line. `returnLineItems` is a union connection; only
 * `ReturnLineItem` (a line tied to a fulfilled order line) is selected, so an
 * `UnverifiedReturnLineItem` arrives as an object with only `__typename`.
 */
export interface ShopifyReturnLineNode {
  readonly __typename: string;
  readonly id?: string;
  readonly quantity?: number;
  readonly returnReasonDefinition?: { readonly handle: string; readonly name: string } | null;
  readonly returnReasonNote?: string | null;
  readonly customerNote?: string | null;
  readonly fulfillmentLineItem?: {
    readonly lineItem: {
      readonly id: string;
      readonly sku: string | null;
      readonly name: string | null;
      readonly variant: { readonly id: string } | null;
      readonly discountedUnitPriceAfterAllDiscountsSet: ShopifyMoneyBag;
    } | null;
  } | null;
}

/** A full return, as `node(id:)` answers it. */
export interface ShopifyReturnNode extends ShopifyReturnFeedNode {
  readonly __typename: 'Return';
  readonly order: { readonly id: string; readonly name: string | null } | null;
  readonly returnLineItems: ShopifyConnection<ShopifyReturnLineNode>;
}

/** Decoded return feed cursor: the order-id keyset of the current lap. */
export interface ShopifyReturnFeedCursor {
  /** ISO time the current lap started; a new value starts a new lap from the newest order. */
  readonly lapStartedAt: string;
  /**
   * Numeric id of the last order whose returns were handed out; null at a
   * lap's start. A lap walks DOWN the ids, so the next page reads below it.
   */
  readonly belowOrderId: string | null;
}
