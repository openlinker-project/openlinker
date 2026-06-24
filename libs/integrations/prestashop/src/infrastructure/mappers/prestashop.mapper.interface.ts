/**
 * PrestaShop Mapper Interfaces
 *
 * Defines interfaces for PrestaShop data mappers. Mappers transform PrestaShop
 * API responses to OpenLinker unified schema, handling localization, field
 * mapping, and data normalization.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 */
import type { Product, ProductVariant } from '@openlinker/core/products';
import type { Inventory } from '@openlinker/core/inventory';
import type { Order, OrderCreate, OrderStatus } from '@openlinker/core/orders';
import type { OptionValueResolver } from '../../domain/types/prestashop-product-option.types';

/**
 * PrestaShop product data (from API response)
 */
export interface PrestashopProduct {
  id: string | number;
  name?: { language?: Array<{ '#text': string; '@_id': string }> } | string;
  description?: { language?: Array<{ '#text': string; '@_id': string }> } | string;
  reference?: string;
  ean13?: string;
  upc?: string;
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
  ean13?: string;
  upc?: string;
  price?: string | number;
  weight?: string | number;
  associations?: {
    // PrestaShop serializes associations in one of two shapes depending on the
    // response format:
    //   - XML (parsed by fast-xml-parser): { product_option_values: { product_option_value: [...] | {...} } }
    //   - JSON (`output_format=JSON`):     { product_option_values: [...] }
    // Both must be accepted by the mapper.
    product_option_values?:
      | Array<{ id: string | number }>
      | {
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
  id_address_delivery?: string | number;
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
 * PrestaShop order_carrier row.
 *
 * One row per (order, carrier). PrestaShop auto-creates the row when an order
 * is POSTed with `id_carrier`; consumers can then PUT the row back to set the
 * per-order shipping cost independently of the carrier's zone-priced rules
 * (#467). The shape mirrors what `GET /order_carriers/{id}` returns; PS WS
 * `PUT` requires the full resource body, so callers must read-then-write.
 */
export interface PrestashopOrderCarrier {
  id: string | number;
  id_order: string | number;
  id_carrier: string | number;
  id_order_invoice?: string | number;
  weight?: string | number;
  shipping_cost_tax_excl?: string | number;
  shipping_cost_tax_incl?: string | number;
  tracking_number?: string;
  date_add?: string;
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
   * @param resolveOptionValue - Optional resolver turning a combination's
   *   `product_option_value` id into `{ attributeGroupName, valueName }` so the
   *   variant carries semantic attributes (e.g. `{ Color: 'Red' }`). When
   *   omitted or unresolved, falls back to the positional `option_${index}` id
   *   shape (variant distinctness + back-compat). The mapper performs no I/O —
   *   the adapter fetches the option dictionary and passes this in (#1050).
   * @returns OpenLinker ProductVariant (without ID - ID mapping handled by adapter)
   */
  mapVariant(
    combination: PrestashopCombination,
    productId: string,
    resolveOptionValue?: OptionValueResolver
  ): Omit<ProductVariant, 'id'>;

  /**
   * Read a PrestaShop localized field (flat string, JSON `[{id,value}]`, or XML
   * `{language:[…]}`) into a single trimmed string for the given language.
   * Exposed so the attribute resolver reuses the one battle-tested parser
   * rather than duplicating it (#1050).
   *
   * @param field - Raw localized field value from a PS WS response
   * @param langId - Preferred language ID (default: 1)
   */
  localizeField(field: unknown, langId?: number): string | undefined;
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
    variantId?: string
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
   * @param externalShippingAddressId - PrestaShop shipping address ID (external, optional)
   * @param externalBillingAddressId - PrestaShop billing address ID (external, optional)
   * @returns PrestaShop order data ready for API submission
   */
  mapOrderCreate(
    orderCreate: OrderCreate,
    externalCustomerId: string | number,
    externalProductIds: Map<string, string | number>,
    externalVariantIds: Map<string, string | number>,
    externalShippingAddressId?: string | number,
    externalBillingAddressId?: string | number,
    externalCurrencyId?: string | number,
    externalLangId?: string | number,
    externalCarrierId?: number
  ): Record<string, unknown>;

  /**
   * Map OpenLinker OrderCreate to PrestaShop cart format
   *
   * Creates a cart structure that can be used to create a cart in PrestaShop,
   * which is then required to create an order.
   *
   * @param orderCreate - OpenLinker order creation request
   * @param externalCustomerId - PrestaShop customer ID (external)
   * @param externalProductIds - Map of internal product IDs to PrestaShop product IDs
   * @param externalVariantIds - Map of internal variant IDs to PrestaShop combination IDs
   * @param externalShippingAddressId - PrestaShop shipping address ID (external, optional)
   * @param externalBillingAddressId - PrestaShop billing address ID (external, optional)
   * @returns PrestaShop cart data ready for API submission
   */
  mapCartCreate(
    orderCreate: OrderCreate,
    externalCustomerId: string | number,
    externalProductIds: Map<string, string | number>,
    externalVariantIds: Map<string, string | number>,
    externalShippingAddressId?: string | number,
    externalBillingAddressId?: string | number,
    externalCurrencyId?: string | number,
    externalLangId?: string | number,
    /**
     * #503: PS reads `id_carrier` off the cart (not the order body) at
     * `POST /orders` time. Without this, every order lands at id_carrier=0.
     */
    externalCarrierId?: number
  ): Record<string, unknown>;

  /**
   * Map an OpenLinker `OrderStatus` to its PrestaShop order-state id
   * (e.g. `'shipped' → 4`). Single source of truth for the status→state-id
   * table, reused by `mapOrderCreate` and by the order-fulfillment update
   * (#858 capability B).
   */
  mapStatusToPrestashopStateId(status: OrderStatus): number;
}
