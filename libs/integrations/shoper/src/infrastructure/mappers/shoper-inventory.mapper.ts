/**
 * Shoper Inventory Mapper
 *
 * Maps a `product-stocks` row onto the neutral `Inventory`. Pure: no I/O, and
 * no identifier mapping - the adapter supplies the internal ids.
 *
 * Stock is pooled and location-less (ADR-058 decision 2: the master declines to
 * locate its stock) and Shoper has no reservation concept, so `reserved` is 0
 * and `available` equals `quantity`.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type { Inventory } from '@openlinker/core/inventory';

import type { ShoperStock } from '../../domain/types/shoper-api.types';
import { parseShoperNumber } from './shoper-product.mapper';

/**
 * The stock level a row states, or `null` when it states none. Shoper serializes
 * it as a string (`"74"`); a missing or non-numeric value is NOT zero - reporting
 * it as 0 would zero a live offer, so the caller must treat `null` as an error.
 * Fractional values are kept as the shop states them.
 */
export function readShoperStockLevel(stock: Pick<ShoperStock, 'stock'>): number | null {
  const level = parseShoperNumber(stock.stock);
  // A negative level is not a stock figure we can publish: treat it as unreadable.
  return level === undefined || level < 0 ? null : level;
}

export interface ShoperInventoryIds {
  readonly productId: string;
  readonly variantId: string;
  readonly inventoryId: string;
}

export function mapShoperStockToInventory(quantity: number, ids: ShoperInventoryIds): Inventory {
  return {
    id: ids.inventoryId,
    productId: ids.productId,
    variantId: ids.variantId,
    locationId: undefined,
    quantity,
    reserved: 0,
    available: quantity,
    updatedAt: undefined,
  };
}
