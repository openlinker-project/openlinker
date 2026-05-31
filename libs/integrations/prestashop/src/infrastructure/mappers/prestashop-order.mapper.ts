/**
 * PrestaShop Order Mapper
 *
 * Maps PrestaShop order and order_detail data to OpenLinker Order schema.
 * Handles customer information, addresses, line items, and totals.
 * Also maps OpenLinker OrderCreate to PrestaShop order format.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 * @implements {IPrestashopOrderMapper}
 */
import type {
  IPrestashopOrderMapper,
  PrestashopOrder,
  PrestashopOrderRow,
} from './prestashop.mapper.interface';
import type { Order, OrderItem, OrderTotals } from '@openlinker/core/orders';
import type { OrderCreate, OrderStatus } from '@openlinker/core/orders';
import { PrestashopProvisioningException } from '@openlinker/integrations-prestashop';
import { Logger } from '@openlinker/shared/logging';
import { toPrestashopProductAttributeId } from './prestashop-variant-id';

/**
 * Default values for PrestaShop cart + order creation. Hoisted to
 * module scope so both `mapOrderCreate` and `mapCartCreate` reference
 * the same source of truth. Future enhancement: move to connection
 * config so per-store overrides don't require a code change.
 */
const DEFAULT_CURRENCY_ID = 1; // EUR
const DEFAULT_LANGUAGE_ID = 1; // First language
const DEFAULT_CARRIER_ID = 1; // First carrier
const DEFAULT_PAYMENT_MODULE = 'ps_checkpayment';
const DEFAULT_PAYMENT_METHOD = 'Check payment';

/**
 * PrestaShop Order Mapper
 *
 * Transforms PrestaShop order data to OpenLinker Order schema.
 */
export class PrestashopOrderMapper implements IPrestashopOrderMapper {
  private readonly logger = new Logger(PrestashopOrderMapper.name);
  mapOrder(prestashopOrder: PrestashopOrder, orderRows: PrestashopOrderRow[]): Omit<Order, 'id'> {
    // Map line items
    const items: OrderItem[] = orderRows.map((row, index) => {
      // PrestaShop uses "0" or 0 to indicate no variant, treat as undefined
      const variantId =
        row.product_attribute_id &&
        String(row.product_attribute_id) !== '0' &&
        row.product_attribute_id !== 0
          ? String(row.product_attribute_id)
          : undefined;

      return {
        id: String(row.id || index),
        productId: '', // Will be set by adapter using identifier mapping
        variantId,
        quantity: this.parseNumber(row.product_quantity) || 0,
        price: this.parseNumber(row.product_price) || 0,
        sku: this.getStringField(row.product_reference),
      };
    });

    // Map totals
    const totals: OrderTotals = {
      subtotal: this.parseNumber(prestashopOrder.total_paid_tax_excl) || 0,
      tax:
        (this.parseNumber(prestashopOrder.total_paid_tax_incl) || 0) -
        (this.parseNumber(prestashopOrder.total_paid_tax_excl) || 0),
      shipping: this.parseNumber(prestashopOrder.total_shipping) || 0,
      total: this.parseNumber(prestashopOrder.total_paid_tax_incl) || 0,
      currency: 'EUR', // Default, can be configured
    };

    return {
      orderNumber: this.getStringField(prestashopOrder.reference),
      status: this.mapOrderStatus(prestashopOrder.current_state),
      customerId: prestashopOrder.id_customer ? String(prestashopOrder.id_customer) : undefined,
      items,
      totals,
      shippingAddress: undefined, // Will be fetched separately if needed
      billingAddress: undefined, // Will be fetched separately if needed
      createdAt: this.parseDate(prestashopOrder.date_add) || new Date(),
      updatedAt: this.parseDate(prestashopOrder.date_upd) || new Date(),
    };
  }

  /**
   * Map PrestaShop order status to OpenLinker status
   *
   * PrestaShop uses numeric status IDs. For MVP, we'll map common statuses.
   * Full implementation would fetch status names from PrestaShop.
   */
  private mapOrderStatus(status?: string | number): string {
    if (!status) {
      return 'pending';
    }

    const statusNum = typeof status === 'number' ? status : parseInt(String(status), 10);

    // Common PrestaShop order status mappings
    // These are typical defaults, but vary by installation
    if (statusNum === 1) return 'pending';
    if (statusNum === 2) return 'processing';
    if (statusNum === 3) return 'processing';
    if (statusNum === 4) return 'shipped';
    if (statusNum === 5) return 'delivered';
    if (statusNum === 6) return 'cancelled';
    if (statusNum === 7) return 'refunded';

    return 'pending'; // Default fallback
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

  /**
   * Parse string field
   */
  private getStringField(value: unknown): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    return String(value);
  }

  /**
   * Parse date field
   */
  private parseDate(value: unknown): Date | undefined {
    if (!value) {
      return undefined;
    }
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? undefined : parsed;
    }
    return undefined;
  }

  /**
   * Map OpenLinker OrderCreate to PrestaShop order format
   *
   * Converts unified OrderCreate request to PrestaShop order structure.
   * Maps internal IDs to external PrestaShop IDs and formats data for API submission.
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
  ): Record<string, unknown> {
    // Map order status to PrestaShop status ID
    // PrestaShop uses numeric status IDs. For MVP, we'll use common defaults:
    // 1 = pending, 2 = payment accepted, 3 = preparation in progress, etc.
    const statusId = this.mapStatusToPrestashopStateId(orderCreate.status);

    // Map order rows (line items)
    const orderRows = orderCreate.items.map((item, index) => {
      const externalProductId = externalProductIds.get(item.productId);
      if (!externalProductId) {
        // Log warning before throwing to help debug mapping issues
        this.logger.warn(
          `No external product ID found for internal product ID: ${item.productId}. ` +
            `This may indicate a missing product mapping or sync issue.`
        );
        throw new PrestashopProvisioningException(
          `No external product ID found for internal product ID: ${item.productId}`,
          undefined,
          undefined
        );
      }

      // Map variant ID if present. Synthetic-variant markers (`product:<n>`)
      // and unmapped variants collapse to 0 ("no combination") — shared with
      // the price-pinning path so the two never drift (#923).
      const externalVariantId = toPrestashopProductAttributeId(
        item.variantId ? externalVariantIds.get(item.variantId) : undefined
      );

      return {
        id: index + 1, // PrestaShop order_row IDs are sequential
        product_id: externalProductId,
        product_attribute_id: externalVariantId,
        product_quantity: item.quantity,
        // NOTE: PrestaShop derives `order_detail` line prices from the cart
        // (the order is created with `id_cart`), so this `product_price` is NOT
        // authoritative — the cart-scoped `specific_prices` the order processor
        // writes before POST /orders pin the buyer-paid price (#895 / ADR-014).
        // Kept for parity with the PS order body shape.
        product_price: item.price.toFixed(6), // PrestaShop expects string with 6 decimals
        product_reference: item.sku || '',
      };
    });

    /**
     * Calculate product totals for PrestaShop order
     *
     * PrestaShop requires separate fields for products with and without tax:
     * - total_products: Subtotal without tax (products cost excluding tax)
     * - total_products_wt: Subtotal with tax (products cost including tax)
     *
     * Formula: total_products_wt = total_products + tax
     */
    const totalProducts = orderCreate.totals.subtotal;
    const totalProductsWt = orderCreate.totals.subtotal + orderCreate.totals.tax;

    /**
     * Shipping totals are intentionally omitted from the create-order body
     * post-#516. PrestaShop computes them from the resolved carrier at
     * POST /orders time:
     *   - OL Dynamic carrier: reads `getOrderShippingCostExternal()` from
     *     the OL module's sidecar table written at Step 6.5 (#515 / #524).
     *   - Static carriers: priced from the carrier's own zone/range tables.
     * Writing total_shipping[_tax_incl|_tax_excl] here either gets ignored
     * by PS or fights the carrier's own computation — both bad.
     */

    /**
     * Currency conversion rate
     *
     * PrestaShop uses conversion_rate to handle multi-currency orders.
     * For now, we default to 1.0 (assuming same currency or 1:1 conversion).
     * Future enhancement: Fetch actual conversion rate from PrestaShop if order currency
     * differs from shop default currency.
     */
    const conversionRate = 1.0;

    // Defaults are module-level constants so mapCartCreate and
    // mapOrderCreate share the same source of truth.

    // Build PrestaShop order structure
    const prestashopOrder: Record<string, unknown> = {
      id_customer: externalCustomerId,
      id_currency: externalCurrencyId || DEFAULT_CURRENCY_ID,
      id_lang: externalLangId || DEFAULT_LANGUAGE_ID,
      id_carrier: externalCarrierId ?? DEFAULT_CARRIER_ID,
      module: DEFAULT_PAYMENT_MODULE,
      payment: DEFAULT_PAYMENT_METHOD,
      current_state: statusId,
      reference: orderCreate.orderNumber || undefined,
      // Financial totals
      total_paid: orderCreate.totals.total.toFixed(2),
      total_paid_real: orderCreate.totals.total.toFixed(2), // Actual amount paid (same as total_paid for new orders)
      total_paid_tax_incl: orderCreate.totals.total.toFixed(2),
      total_paid_tax_excl: orderCreate.totals.subtotal.toFixed(2),
      total_products: totalProducts.toFixed(2), // Products total without tax
      total_products_wt: totalProductsWt.toFixed(2), // Products total with tax
      // total_shipping[_tax_incl|_tax_excl] intentionally omitted post-#516.
      // PS computes shipping from the resolved carrier (OL Dynamic via sidecar
      // or static via zone tables) at order-create time.
      conversion_rate: conversionRate.toFixed(6), // Currency conversion rate (6 decimals)
      // PrestaShop requires associations for order_rows
      associations: {
        order_rows: {
          order_row: orderRows,
        },
      },
    };

    // Add address IDs (PrestaShop requires both delivery and invoice addresses)
    // Ensure at least one address is set, use it for both if only one provided
    if (externalShippingAddressId && externalBillingAddressId) {
      prestashopOrder.id_address_delivery = externalShippingAddressId;
      prestashopOrder.id_address_invoice = externalBillingAddressId;
    } else if (externalShippingAddressId) {
      // Use shipping address for both if only shipping provided
      prestashopOrder.id_address_delivery = externalShippingAddressId;
      prestashopOrder.id_address_invoice = externalShippingAddressId;
    } else if (externalBillingAddressId) {
      // Use billing address for both if only billing provided
      prestashopOrder.id_address_delivery = externalBillingAddressId;
      prestashopOrder.id_address_invoice = externalBillingAddressId;
    } else {
      // This should not happen in practice, but throw error to make it explicit
      throw new PrestashopProvisioningException(
        'Both shipping and billing addresses are missing. At least one address is required for PrestaShop order creation.'
      );
    }

    // Validate required fields (including address IDs that were just added)
    this.validateOrderData(prestashopOrder);

    return prestashopOrder;
  }

  /**
   * Map OrderCreate to PrestaShop cart format
   *
   * Creates a cart structure that can be used to create a cart in PrestaShop,
   * which is then required to create an order.
   *
   * #503: `externalCarrierId` MUST be set on the cart, not just the order
   * body. PS resolves the order's `id_carrier` from the cart at `POST /orders`
   * time and ignores the order body's `id_carrier` field.
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
    externalCarrierId?: number
  ): Record<string, unknown> {
    // Map cart rows (products)
    const cartRows = orderCreate.items.map((item, index) => {
      const externalProductId = externalProductIds.get(item.productId);
      if (!externalProductId) {
        // Log warning before throwing to help debug mapping issues
        this.logger.warn(
          `No external product ID found for internal product ID: ${item.productId}. ` +
            `This may indicate a missing product mapping or sync issue.`
        );
        throw new PrestashopProvisioningException(
          `No external product ID found for internal product ID: ${item.productId}`,
          undefined,
          undefined
        );
      }

      // Map variant ID if present. Synthetic-variant markers (`product:<n>`)
      // and unmapped variants collapse to 0 ("no combination") — shared with
      // the price-pinning path so the two never drift (#923).
      const externalVariantId = toPrestashopProductAttributeId(
        item.variantId ? externalVariantIds.get(item.variantId) : undefined
      );

      return {
        id: index + 1,
        id_product: externalProductId,
        id_product_attribute: externalVariantId,
        quantity: item.quantity,
      };
    });

    // Build PrestaShop cart structure. id_carrier is set here (not just on
    // the order body) because PS resolves the order's carrier from the cart
    // and ignores the order body's id_carrier (#503). DEFAULT_*_ID constants
    // are module-level — same source of truth as mapOrderCreate.
    const prestashopCart: Record<string, unknown> = {
      id_customer: externalCustomerId,
      id_currency: externalCurrencyId || DEFAULT_CURRENCY_ID,
      id_lang: externalLangId || DEFAULT_LANGUAGE_ID,
      id_carrier: externalCarrierId ?? DEFAULT_CARRIER_ID,
      associations: {
        cart_rows: {
          cart_row: cartRows,
        },
      },
    };

    // Add address IDs if provided
    if (externalShippingAddressId) {
      prestashopCart.id_address_delivery = externalShippingAddressId;
    }
    if (externalBillingAddressId) {
      prestashopCart.id_address_invoice = externalBillingAddressId;
    }
    // If only one address provided, use it for both delivery and invoice
    if (externalShippingAddressId && !externalBillingAddressId) {
      prestashopCart.id_address_invoice = externalShippingAddressId;
    }
    if (externalBillingAddressId && !externalShippingAddressId) {
      prestashopCart.id_address_delivery = externalBillingAddressId;
    }

    return prestashopCart;
  }

  /**
   * Map OpenLinker `OrderStatus` to a PrestaShop order-state id.
   *
   * **Assumes a default PrestaShop install** (state ids 1/2/4/5/6/7). Merchants
   * who customize the order-state catalogue (rename/reorder/add states) would
   * need a per-connection override — the resolution-chain follow-up tracked in
   * #862. This is the fallback tier of that chain.
   *
   * The switch is **compile-time exhaustive over `OrderStatus`**: adding a new
   * status to the union without mapping it here is a type error (the `never`
   * guard), not a silent default-to-pending — which on the `updateFulfillment`
   * projection path (with `sendmail`) would otherwise mis-transition + mis-email.
   */
  mapStatusToPrestashopStateId(status: OrderStatus): number {
    // Default-install PrestaShop order-state ids.
    switch (status) {
      case 'pending':
        return 1; // Awaiting check payment
      case 'processing':
        return 2; // Payment accepted
      case 'shipped':
        return 4; // Shipped
      case 'delivered':
        return 5; // Delivered
      case 'cancelled':
        return 6; // Canceled
      case 'refunded':
        return 7; // Refunded
      default: {
        const _exhaustive: never = status;
        throw new Error(
          `Unmapped OrderStatus → PrestaShop state id: ${String(_exhaustive)} (update the mapper / #862)`
        );
      }
    }
  }

  /**
   * Validate that all required PrestaShop order fields are present
   *
   * Throws PrestashopProvisioningException if any required field is missing.
   * This ensures we catch missing fields before API submission.
   *
   * @param orderData - PrestaShop order data to validate
   * @throws PrestashopProvisioningException if required field is missing
   */
  private validateOrderData(orderData: Record<string, unknown>): void {
    const requiredFields = [
      'id_customer',
      'id_currency',
      'id_lang',
      'id_carrier',
      'module',
      'payment',
      'current_state',
      'id_address_delivery', // Required by PrestaShop
      'id_address_invoice', // Required by PrestaShop
      'total_paid',
      'total_paid_real',
      'total_paid_tax_incl',
      'total_paid_tax_excl',
      'total_products',
      'total_products_wt',
      // total_shipping[_tax_incl|_tax_excl] removed post-#516 — see mapOrderCreate JSDoc.
      'conversion_rate',
      'associations',
    ];

    const missingFields: string[] = [];
    for (const field of requiredFields) {
      if (orderData[field] === undefined || orderData[field] === null) {
        missingFields.push(field);
      }
    }

    if (missingFields.length > 0) {
      throw new PrestashopProvisioningException(
        `Required fields are missing in order data: ${missingFields.join(', ')}`
      );
    }

    // Validate associations.order_rows exists and is not empty
    const associations = orderData.associations as Record<string, unknown>;
    if (!associations || !associations.order_rows) {
      throw new PrestashopProvisioningException(
        'Required field "associations.order_rows" is missing in order data'
      );
    }

    const orderRows = (associations.order_rows as Record<string, unknown>).order_row;
    if (!orderRows || (Array.isArray(orderRows) && orderRows.length === 0)) {
      throw new PrestashopProvisioningException('Order must have at least one order row');
    }
  }
}
