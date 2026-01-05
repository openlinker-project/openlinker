/**
 * PrestaShop Inventory Mapper
 *
 * Maps PrestaShop stock_available data to OpenLinker Inventory schema.
 * Handles product stock vs variant stock (id_product_attribute).
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 * @implements {IPrestashopInventoryMapper}
 */
import { IPrestashopInventoryMapper, PrestashopStockAvailable } from './prestashop.mapper.interface';
import { Inventory } from '@openlinker/core/inventory';

/**
 * PrestaShop Inventory Mapper
 *
 * Transforms PrestaShop stock_available data to OpenLinker Inventory schema.
 */
export class PrestashopInventoryMapper implements IPrestashopInventoryMapper {
  mapInventory(
    stockAvailable: PrestashopStockAvailable,
    productId: string,
    variantId?: string,
  ): Omit<Inventory, 'id'> {
    const quantity = this.parseNumber(stockAvailable.quantity) || 0;
    const reserved = 0; // PrestaShop doesn't provide reserved quantity in stock_available

    return {
      productId,
      variantId,
      locationId: undefined, // PrestaShop doesn't support multi-location in stock_available
      quantity,
      reserved,
      available: quantity - reserved,
      updatedAt: undefined, // PrestaShop doesn't provide update timestamp in stock_available
    };
  }

  /**
   * Parse number field (handles string or number)
   */
  private parseNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  }
}




