/**
 * Amazon Refund Allocation Policy (#4184)
 *
 * Amazon's payment adjustment feed refunds per order item, while OpenLinker
 * asks for one amount per return. This splits the amount over the order items
 * it is for, in integer minor units so the parts always add up to the amount:
 *
 *   - the returned items when the return is known (matched by seller SKU, up
 *     to the returned quantity), otherwise every item of the order;
 *   - in order item order, each item taking at most its price times the
 *     quantity it stands for;
 *   - an amount larger than those items' price is refused, never spread onto
 *     items that were not returned or onto shipping: Amazon caps a refund at
 *     what was paid for an item, and a wrong split would refund the wrong
 *     thing.
 *
 * @module libs/integrations/amazon/src/domain/policies
 */

export interface AmazonRefundOrderItem {
  readonly orderItemId: string;
  readonly sku: string | null;
  /** Price paid per unit, in minor units. */
  readonly unitPriceMinor: number;
  readonly quantity: number;
}

export interface AmazonRefundReturnedLine {
  readonly sku: string | null;
  readonly quantity: number;
}

export interface AmazonRefundAllocationPart {
  readonly orderItemId: string;
  readonly amountMinor: number;
}

export type AmazonRefundAllocation =
  | { readonly ok: true; readonly parts: readonly AmazonRefundAllocationPart[] }
  | { readonly ok: false; readonly reason: string };

export function allocateAmazonRefund(
  amountMinor: number,
  items: readonly AmazonRefundOrderItem[],
  returned: readonly AmazonRefundReturnedLine[] | null,
): AmazonRefundAllocation {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    return { ok: false, reason: 'the refund amount must be positive' };
  }
  const capacities = returned === null ? wholeOrder(items) : returnedItems(items, returned);
  if (capacities.length === 0) {
    return { ok: false, reason: 'none of the returned items is on the Amazon order' };
  }
  let remaining = amountMinor;
  const parts: AmazonRefundAllocationPart[] = [];
  for (const { orderItemId, capacityMinor } of capacities) {
    if (remaining === 0) break;
    const take = Math.min(remaining, capacityMinor);
    if (take > 0) {
      parts.push({ orderItemId, amountMinor: take });
      remaining -= take;
    }
  }
  if (remaining > 0) {
    return { ok: false, reason: 'the refund is larger than what was paid for the items it is for' };
  }
  return { ok: true, parts };
}

function wholeOrder(items: readonly AmazonRefundOrderItem[]): { orderItemId: string; capacityMinor: number }[] {
  return items.map((item) => ({ orderItemId: item.orderItemId, capacityMinor: item.unitPriceMinor * item.quantity }));
}

function returnedItems(
  items: readonly AmazonRefundOrderItem[],
  returned: readonly AmazonRefundReturnedLine[],
): { orderItemId: string; capacityMinor: number }[] {
  const left = new Map<string, number>();
  for (const line of returned) {
    if (line.sku === null) continue;
    left.set(line.sku, (left.get(line.sku) ?? 0) + line.quantity);
  }
  const capacities: { orderItemId: string; capacityMinor: number }[] = [];
  for (const item of items) {
    const want = item.sku === null ? 0 : (left.get(item.sku) ?? 0);
    const units = Math.min(want, item.quantity);
    if (units <= 0 || item.sku === null) continue;
    left.set(item.sku, want - units);
    capacities.push({ orderItemId: item.orderItemId, capacityMinor: item.unitPriceMinor * units });
  }
  return capacities;
}
