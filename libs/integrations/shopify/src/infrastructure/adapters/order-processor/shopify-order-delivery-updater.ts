/**
 * Shopify Order Delivery Updater
 *
 * Carries a changed delivery point / shipping method to the Shopify copy of an
 * order (#4195, `OrderDeliveryUpdater`). Built from the SAME helpers the create
 * uses (`shopifyShippingTitle`, `pickupPointAttributes`, `pickupPointNote`), so
 * a create and a later update cannot word the shipping line differently.
 *
 * Which mutation edits which field (confirmed against a dev store, 2026-10):
 *   - Shipping line: only the order edit API. `orderEditUpdateShippingLine`
 *     works on a line added during the SAME edit, so an existing line is
 *     removed and a new one added, then `orderEditCommit` (no customer
 *     notification). The added line keeps the old price and carries the new
 *     title; its `code` becomes `custom` (the add input has no code).
 *   - Custom attributes and note: `orderUpdate`. Only the three pickup-point
 *     attributes and the note line starting `Pickup point:` are rewritten, so
 *     attributes and notes an operator added by hand survive.
 *
 * Refused, not edited: a cancelled or closed order, and one that is no longer
 * UNFULFILLED (its shipping line describes a parcel that already left).
 *
 * Re-runnable: the edit is skipped when the line already carries the title, so
 * a retry after a half-applied update finishes the rest and a repeat changes
 * nothing.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/order-processor
 */
import type { OrderCreate, OrderDeliveryUpdateResult } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import { toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import {
  PICKUP_POINT_ATTRIBUTE_KEYS,
  PICKUP_POINT_NOTE_PREFIX,
  pickupPointAttributes,
  pickupPointNote,
  shopifyShippingTitle,
  type ShopifyOrderMappedOptions,
} from '../../mappers/shopify-order-input.mapper';
import {
  ORDER_DELIVERY_QUERY,
  ORDER_EDIT_ADD_SHIPPING_LINE_MUTATION,
  ORDER_EDIT_BEGIN_MUTATION,
  ORDER_EDIT_COMMIT_MUTATION,
  ORDER_EDIT_REMOVE_SHIPPING_LINE_MUTATION,
  ORDER_UPDATE_MUTATION,
} from '../../readers/shopify-order.queries';

interface Money {
  readonly shopMoney: { readonly amount: string; readonly currencyCode: string };
}

interface OrderDeliveryQuery {
  readonly order: {
    readonly id: string;
    readonly cancelledAt: string | null;
    readonly closedAt: string | null;
    readonly displayFulfillmentStatus: string;
    readonly note: string | null;
    readonly customAttributes: ReadonlyArray<{ readonly key: string; readonly value: string | null }>;
    readonly shippingLines: {
      readonly nodes: ReadonlyArray<{
        readonly id: string;
        readonly title: string;
        readonly originalPriceSet: Money;
        readonly taxLines?: ReadonlyArray<{ readonly rate: number }>;
      }>;
    };
  } | null;
}

interface OrderEditBeginPayload {
  readonly calculatedOrder: {
    readonly id: string;
    readonly shippingLines: ReadonlyArray<{ readonly id: string; readonly title: string; readonly price: Money }>;
  } | null;
}

const UNFULFILLED = 'UNFULFILLED';
const SHIPPING_TAX_CAVEAT =
  'The shipping line was replaced without its VAT line; the Shopify order shows less tax on shipping';
const EDIT_STAFF_NOTE = 'OpenLinker: delivery point changed at the source';

export class ShopifyOrderDeliveryUpdater {
  private readonly logger = new Logger(ShopifyOrderDeliveryUpdater.name);

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly connectionId: string,
  ) {}

  async update(
    externalOrderId: string,
    order: OrderCreate,
    mapped: ShopifyOrderMappedOptions,
  ): Promise<OrderDeliveryUpdateResult> {
    const id = toShopifyGid('Order', externalOrderId);
    const { order: current } = await this.client.query<OrderDeliveryQuery>(ORDER_DELIVERY_QUERY, { id });
    if (current === null) {
      return { outcome: 'refused', reason: 'not-found', detail: 'Shopify no longer has this order' };
    }
    if (current.cancelledAt !== null) {
      return { outcome: 'refused', reason: 'cancelled', detail: 'The Shopify order is cancelled' };
    }
    if (current.closedAt !== null) {
      return { outcome: 'refused', reason: 'closed', detail: 'The Shopify order is closed' };
    }
    if (current.displayFulfillmentStatus !== UNFULFILLED) {
      return {
        outcome: 'refused',
        reason: 'fulfilled',
        detail: `The Shopify order is already ${current.displayFulfillmentStatus.toLowerCase().replace(/_/g, ' ')}`,
      };
    }

    const title = shopifyShippingTitle(order, mapped);
    const lines = current.shippingLines.nodes;
    const editShipping = lines.length === 1 && lines[0].title !== title;
    if (lines.length > 1) {
      this.logger.warn(
        `Shopify order ${externalOrderId} has ${lines.length} shipping lines; the shipping line is left ` +
          `as is and only the pickup-point details are updated (connection: ${this.connectionId})`,
      );
    }

    const attributes = this.desiredAttributes(current.customAttributes, order);
    const note = this.desiredNote(current.note, order);
    const attributesChanged = !sameAttributes(current.customAttributes, attributes);
    const noteChanged = (current.note ?? '') !== note;

    if (!editShipping && !attributesChanged && !noteChanged) {
      return { outcome: 'unchanged' };
    }

    if (attributesChanged || noteChanged) {
      await this.client.mutate(
        ORDER_UPDATE_MUTATION,
        { input: { id, note, customAttributes: attributes } },
        'orderUpdate',
      );
    }
    if (editShipping) {
      await this.replaceShippingLine(id, title);
      // Confirmed live: the order edit API cannot carry a tax line onto the
      // replacement, so the copy's VAT on shipping drops out of its tax totals
      // (the total price is unchanged on a tax-inclusive order). Said, not hidden.
      if ((lines[0].taxLines ?? []).length > 0) {
        this.logger.warn(
          `Shopify order ${externalOrderId}: the replaced shipping line lost its tax line ` +
            `(connection: ${this.connectionId})`,
        );
        return { outcome: 'updated', detail: SHIPPING_TAX_CAVEAT };
      }
    }
    return { outcome: 'updated' };
  }

  /**
   * Remove the existing line and add one with the new title and the OLD price,
   * in one edit session. A failure before the commit leaves the order as it
   * was: Shopify drops an uncommitted edit.
   */
  private async replaceShippingLine(orderGid: string, title: string): Promise<void> {
    const begun = await this.client.mutate<OrderEditBeginPayload>(
      ORDER_EDIT_BEGIN_MUTATION,
      { id: orderGid },
      'orderEditBegin',
    );
    const calculated = begun.calculatedOrder;
    const line = calculated?.shippingLines[0];
    if (calculated === null || calculated === undefined || line === undefined) {
      throw new Error(`Shopify order edit of ${orderGid} returned no shipping line to replace`);
    }
    await this.client.mutate(
      ORDER_EDIT_REMOVE_SHIPPING_LINE_MUTATION,
      { id: calculated.id, shippingLineId: line.id },
      'orderEditRemoveShippingLine',
    );
    await this.client.mutate(
      ORDER_EDIT_ADD_SHIPPING_LINE_MUTATION,
      {
        id: calculated.id,
        shippingLine: {
          title,
          price: { amount: line.price.shopMoney.amount, currencyCode: line.price.shopMoney.currencyCode },
        },
      },
      'orderEditAddShippingLine',
    );
    await this.client.mutate(
      ORDER_EDIT_COMMIT_MUTATION,
      { id: calculated.id, staffNote: EDIT_STAFF_NOTE },
      'orderEditCommit',
    );
  }

  /** Every attribute the copy carries, minus the pickup point's, plus the order's current ones. */
  private desiredAttributes(
    existing: ReadonlyArray<{ readonly key: string; readonly value: string | null }>,
    order: OrderCreate,
  ): Array<{ key: string; value: string }> {
    const kept = existing
      .filter((a) => !PICKUP_POINT_ATTRIBUTE_KEYS.includes(a.key))
      .map((a) => ({ key: a.key, value: a.value ?? '' }));
    return [...kept, ...pickupPointAttributes(order.pickupPoint)];
  }

  /** The note with its pickup-point line replaced; every other line is kept. */
  private desiredNote(existing: string | null, order: OrderCreate): string {
    const kept = (existing ?? '')
      .split('\n')
      .filter((line) => line.length > 0 && !line.startsWith(PICKUP_POINT_NOTE_PREFIX));
    const line = pickupPointNote(order.pickupPoint);
    return [...kept, ...(line === null ? [] : [line])].join('\n');
  }
}

function sameAttributes(
  existing: ReadonlyArray<{ readonly key: string; readonly value: string | null }>,
  desired: ReadonlyArray<{ readonly key: string; readonly value: string }>,
): boolean {
  if (existing.length !== desired.length) {
    return false;
  }
  return existing.every((a, i) => a.key === desired[i].key && (a.value ?? '') === desired[i].value);
}
