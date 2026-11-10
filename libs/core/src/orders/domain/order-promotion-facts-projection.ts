/**
 * Order -> Promotion Facts Projection (#3935)
 *
 * Builds the `PromotionOrderFacts` the promotions context evaluates conditions
 * against, from one persisted `OrderRecord`. The promotions context takes facts
 * as an argument and imports nothing from `orders`, so this projection lives on
 * this side. Absence means UNKNOWN: a record that is not `ready` has no resolved
 * ids, so the line facts stay absent rather than asserting "no lines".
 *
 * @module libs/core/src/orders/domain
 */
import type { PromotionOrderFacts } from '@openlinker/core/promotions';

import type { OrderRecord } from './entities/order-record.entity';
import { readSnapshotCountry } from './order-automation-facts-projection';

export function buildOrderPromotionFacts(
  record: OrderRecord,
  occurredAt: Date | undefined
): PromotionOrderFacts {
  return {
    orderId: record.internalOrderId,
    ...(occurredAt !== undefined && { occurredAt }),
    sourceConnectionId: record.sourceConnectionId,
    ...(readSnapshotCountry(record.orderSnapshot) !== undefined && {
      country: readSnapshotCountry(record.orderSnapshot),
    }),
    ...(record.totalAmount !== null && record.totalAmount !== undefined && {
      totalGross: record.totalAmount,
    }),
    ...(record.currency !== null && record.currency !== undefined && { currency: record.currency }),
    ...(record.recordStatus === 'ready'
      ? {
          // Gift lines never satisfy a purchase condition.
          lineProductIds: record.orderItems.filter((i) => i.gift === undefined).map((i) => i.productId),
          lineVariantIds: record.orderItems.flatMap((i) =>
            i.gift === undefined && i.variantId !== undefined ? [i.variantId] : []
          ),
        }
      : {}),
  };
}
