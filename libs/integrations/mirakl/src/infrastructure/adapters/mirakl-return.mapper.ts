/**
 * Mirakl Return Mapper
 *
 * RT11 return (plus its order, when it could be read) to core's neutral
 * `IncomingReturn` (#4279). RT11 lines carry only the order line id, quantity
 * and reason, so the order (OR11) supplies what core's line resolution matches
 * on: the line's `offer_sku`, title and unit price. Without the order a line
 * is still reported, with what RT11 alone says.
 *
 * The reason stays Mirakl's own code (`RETURN_BROKEN_ITEM`, ...), verbatim:
 * mapping it is core's decision. A line without its own reason takes the
 * return's.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import type { IncomingReturn, IncomingReturnLine } from '@openlinker/core/returns';
import { isTerminalReturnState } from '../../domain/policies/mirakl-return.policy';
import type { MiraklOrder, MiraklOrderLine } from '../../domain/types/mirakl-order.types';
import type { MiraklReturn } from '../../domain/types/mirakl-return.types';

export function mapMiraklReturn(
  miraklReturn: MiraklReturn,
  order: MiraklOrder | null
): IncomingReturn {
  const orderLines = new Map<string, MiraklOrderLine>(
    (order?.order_lines ?? [])
      .filter((line) => line.order_line_id)
      .map((line) => [line.order_line_id as string, line])
  );
  const lines: IncomingReturnLine[] = (miraklReturn.return_lines ?? []).map((line) => {
    const orderLine = line.order_line_id ? orderLines.get(line.order_line_id) : undefined;
    const reason = line.reason_code ?? miraklReturn.reason_code;
    return {
      ...(line.order_line_id && { externalLineId: line.order_line_id }),
      ...(orderLine?.offer_sku && { offerId: orderLine.offer_sku, sku: orderLine.offer_sku }),
      ...(orderLine?.product_title && { name: orderLine.product_title }),
      quantity: typeof line.quantity === 'number' ? line.quantity : 0,
      ...(typeof orderLine?.price_unit === 'number' && { unitPrice: orderLine.price_unit }),
      ...(reason && { reasonRaw: reason }),
      raw: line,
    };
  });
  return {
    externalReturnId: miraklReturn.id ?? '',
    externalOrderId: miraklReturn.order_id ?? null,
    ...(miraklReturn.rma && { referenceNumber: miraklReturn.rma }),
    rawStatus: miraklReturn.state ?? '',
    createdAt: miraklReturn.date_created ?? miraklReturn.last_updated ?? '',
    isTerminalAtSource: isTerminalReturnState(miraklReturn.state),
    lines,
    raw: miraklReturn,
  };
}
