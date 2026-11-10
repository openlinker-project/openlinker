/**
 * Gift unit cost freeze (#3939, ADR-080 decision 3)
 *
 * The one place a gift line's purchase cost is taken, shared by the rule writer
 * (ingestion) and the manual writer (the operator's add-a-gift), so the two
 * cannot disagree on what a gift cost. The variant's net cost is frozen onto the
 * overlay entry only when it was entered no later than the order's `placedAt`
 * (both floored to the second): an old order never reads today's cost. An unknown
 * cost, or a failed read, yields no cost at all - never 0.
 *
 * @module libs/core/src/orders/application/services
 */
import type { IProductsService } from '@openlinker/core/products';

import type { OrderAddedLineEdit } from '../../domain/types/order-edits.types';

export type FrozenGiftCost = Pick<OrderAddedLineEdit, 'unitCostNet' | 'unitCostCurrency'>;

export async function freezeGiftUnitCost(
  products: Pick<IProductsService, 'getVariantsByIds'>,
  variantId: string,
  placedAt: Date,
  logger: { warn(message: string): void },
): Promise<FrozenGiftCost> {
  try {
    const [variant] = await products.getVariantsByIds([variantId]);
    const second = (date: Date): number => Math.floor(date.getTime() / 1000);
    if (
      variant?.netUnitCost != null &&
      variant.costCurrency != null &&
      variant.costUpdatedAt != null &&
      second(variant.costUpdatedAt) <= second(placedAt)
    ) {
      return { unitCostNet: variant.netUnitCost, unitCostCurrency: variant.costCurrency };
    }
  } catch (error) {
    logger.warn(
      `Cost for gift variant ${variantId} could not be read: ${(error as Error).message}`,
    );
  }
  return {};
}
