/**
 * Shopify Incoming Return Mapper
 *
 * Maps a Shopify `Return` onto the neutral `IncomingReturn`. Everything is
 * carried as the source reports it: the raw `ReturnStatus`, the raw
 * `returnReasonDefinition.handle` value (core maps reasons where the aggregate is
 * written), quantities, sku and name. The only derivation is the
 * `isTerminalAtSource` hint, from the same constant the adapter publishes as
 * `terminalRawStatuses`.
 *
 * Line linkage: `sku` is the field core resolves a returned line to an order
 * line by, and the Shopify order mapper writes the line's sku there too.
 * `offerId` is deliberately left unset - core compares it against the order
 * line's sku, so a variant id there could never match. The unit price is the
 * line's unit price after every discount, the figure the order mapper reports as the
 * order line's `price`, which core uses to break a same-sku tie.
 *
 * An `UnverifiedReturnLineItem` (a returned item not tied to a fulfilled order
 * line) is kept, with its quantity and no identity, so a return is never
 * reported smaller than it is.
 *
 * @module libs/integrations/shopify/src/infrastructure/mappers
 */
import type { IncomingReturn, IncomingReturnLine } from '@openlinker/core/returns';

import { fromShopifyGid } from '../../domain/policies/shopify-gid.policy';
import {
  SHOPIFY_RETURN_TERMINAL_STATUSES,
  type ShopifyReturnLineNode,
  type ShopifyReturnNode,
} from '../../domain/types/shopify-return.types';

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function mapLine(line: ShopifyReturnLineNode): IncomingReturnLine {
  const orderLine = line.fulfillmentLineItem?.lineItem ?? null;
  const sku = nonEmpty(orderLine?.sku);
  const name = nonEmpty(orderLine?.name);
  const reason = nonEmpty(line.returnReasonDefinition?.handle);
  const price =
    orderLine === null ? NaN : Number(orderLine.discountedUnitPriceAfterAllDiscountsSet.shopMoney.amount);
  return {
    ...(line.id === undefined ? {} : { externalLineId: fromShopifyGid(line.id) }),
    ...(sku === undefined ? {} : { sku }),
    ...(name === undefined ? {} : { name }),
    quantity: line.quantity ?? 0,
    ...(Number.isFinite(price) ? { unitPrice: price } : {}),
    ...(reason === undefined ? {} : { reasonRaw: reason }),
    raw: line,
  };
}

export function mapShopifyReturnToIncoming(node: ShopifyReturnNode): IncomingReturn {
  const name = nonEmpty(node.name);
  return {
    externalReturnId: fromShopifyGid(node.id),
    externalOrderId: node.order === null ? null : fromShopifyGid(node.order.id),
    ...(name === undefined ? {} : { referenceNumber: name }),
    rawStatus: node.status,
    createdAt: node.createdAt ?? new Date(0).toISOString(),
    isTerminalAtSource: SHOPIFY_RETURN_TERMINAL_STATUSES.includes(node.status),
    lines: node.returnLineItems.nodes.map(mapLine),
    raw: node,
  };
}
