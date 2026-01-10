/**
 * PrestaShop Mapper Interfaces
 *
 * Defines interfaces for PrestaShop data mappers. Mappers transform PrestaShop
 * API responses to OpenLinker unified schema, handling localization, field
 * mapping, and data normalization.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 */
import { Product, ProductVariant } from '@openlinker/core/products';
import { Inventory } from '@openlinker/core/inventory';
import { Order, OrderCreate } from '@openlinker/core/orders';

/**
 * PrestaShop product data (from API response)
 */
export interface PrestashopProduct {
  id: string | number;
  name?: { language?: Array<{ '#text': string; '@_id': string }> } | string;
  description?: { language?: Array<{ '#text': string; '@_id': string }> } | string;
  reference?: string;
  price?: string | number;
  weight?: string | number;
  active?: string | number;
  [key: string]: unknown;
}

/**
 * PrestaShop combination (variant) data
 */
export interface PrestashopCombination {
  id: string | number;
  id_product: string | number;
  reference?: string;
  price?: string | number;
  weight?: string | number;
  associations?: {
    product_option_values?: {
      product_option_value?: Array<{ id: string | number }> | { id: string | number };
    };
  };
  [key: string]: unknown;
}

/**
 * PrestaShop stock_available data
 */
export interface PrestashopStockAvailable {
  id: string | number;
  id_product: string | number;
  id_product_attribute: string | number; // 0 for product stock, >0 for variant stock
  quantity: string | number;
  out_of_stock?: string | number;
  [key: string]: unknown;
}

/**
 * PrestaShop order data
 */
export interface PrestashopOrder {
  id: string | number;
  reference?: string;
  id_customer?: string | number;
  current_state?: string | number;
  total_paid?: string | number;
  total_paid_tax_incl?: string | number;
  total_paid_tax_excl?: string | number;
  total_shipping?: string | number;
  date_add?: string;
  date_upd?: string;
  associations?: {
    order_rows?: {
      order_row?: Array<PrestashopOrderRow> | PrestashopOrderRow;
    };
  };
  [key: string]: unknown;
}

/**
 * PrestaShop order row (line item) data
 */
export interface PrestashopOrderRow {
  id: string | number;
  product_id?: string | number;
  product_attribute_id?: string | number;
  product_quantity?: string | number;
  product_price?: string | number;
  product_reference?: string;
  [key: string]: unknown;
}

/**
 * PrestaShop Product Mapper Interface
 */
export interface IPrestashopProductMapper {
  /**
   * Map PrestaShop product to OpenLinker Product
   *
   * @param prestashopProduct - PrestaShop product data
   * @param langId - Language ID for localized fields (default: 1)
   * @returns OpenLinker Product (without ID - ID mapping handled by adapter)
   */
  mapProduct(prestashopProduct: PrestashopProduct, langId?: number): Omit<Product, 'id'>;

  /**
   * Map PrestaShop combination to OpenLinker ProductVariant
   *
   * @param combination - PrestaShop combination data
   * @param productId - Internal OpenLinker product ID
   * @returns OpenLinker ProductVariant (without ID - ID mapping handled by adapter)
   */
  mapVariant(combination: PrestashopCombination, productId: string): Omit<ProductVariant, 'id'>;
}

/**
 * PrestaShop Inventory Mapper Interface
 */
export interface IPrestashopInventoryMapper {
  /**
   * Map PrestaShop stock_available to OpenLinker Inventory
   *
   * @param stockAvailable - PrestaShop stock_available data
   * @param productId - Internal OpenLinker product ID
   * @param variantId - Internal OpenLinker variant ID (if variant stock)
   * @returns OpenLinker Inventory (without ID - ID mapping handled by adapter)
   */
  mapInventory(
    stockAvailable: PrestashopStockAvailable,
    productId: string,
    variantId?: string,
  ): Omit<Inventory, 'id'>;
}

/**
 * PrestaShop Order Mapper Interface
 */
export interface IPrestashopOrderMapper {
  /**
   * Map PrestaShop order to OpenLinker Order
   *
   * @param prestashopOrder - PrestaShop order data
   * @param orderRows - PrestaShop order rows (line items)
   * @returns OpenLinker Order (without ID - ID mapping handled by adapter)
   */
  mapOrder(prestashopOrder: PrestashopOrder, orderRows: PrestashopOrderRow[]): Omit<Order, 'id'>;

  /**
   * Map OpenLinker OrderCreate to PrestaShop order format
   *
   * @param orderCreate - OpenLinker order creation request
   * @param externalCustomerId - PrestaShop customer ID (external)
   * @param externalProductIds - Map of internal product IDs to PrestaShop product IDs
   * @param externalVariantIds - Map of internal variant IDs to PrestaShop combination IDs
   * @returns PrestaShop order data ready for API submission
   */
  mapOrderCreate(
    orderCreate: OrderCreate,
    externalCustomerId: string | number,
    externalProductIds: Map<string, string | number>,
    externalVariantIds: Map<string, string | number>,
  ): Record<string, unknown>;
}




