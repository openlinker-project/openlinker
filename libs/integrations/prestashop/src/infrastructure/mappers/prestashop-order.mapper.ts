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
import { IPrestashopOrderMapper, PrestashopOrder, PrestashopOrderRow } from './prestashop.mapper.interface';
import { Order, OrderItem, OrderTotals } from '@openlinker/core/orders';
import { OrderCreate } from '@openlinker/core/orders';
import { PrestashopProvisioningException } from '@openlinker/integrations-prestashop';
import { Logger } from '@openlinker/shared/logging';

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
      const variantId = row.product_attribute_id && 
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
  ): Record<string, unknown> {
    // Map order status to PrestaShop status ID
    // PrestaShop uses numeric status IDs. For MVP, we'll use common defaults:
    // 1 = pending, 2 = payment accepted, 3 = preparation in progress, etc.
    const statusId = this.mapOrderStatusToPrestashop(orderCreate.status);

    // Map order rows (line items)
    const orderRows = orderCreate.items.map((item, index) => {
      const externalProductId = externalProductIds.get(item.productId);
      if (!externalProductId) {
        // Log warning before throwing to help debug mapping issues
        this.logger.warn(
          `No external product ID found for internal product ID: ${item.productId}. ` +
            `This may indicate a missing product mapping or sync issue.`,
        );
        throw new PrestashopProvisioningException(
          `No external product ID found for internal product ID: ${item.productId}`,
          undefined,
          undefined,
        );
      }

      // Map variant ID if present
      let externalVariantId: number;
      if (item.variantId) {
        const variantId = externalVariantIds.get(item.variantId);
        // If variant mapping not found, use 0 (no variant) or throw error
        if (variantId === undefined) {
          // For MVP, we'll allow missing variant mappings and use 0
          externalVariantId = 0;
        } else {
          // Ensure variant ID is a number
          externalVariantId = typeof variantId === 'string' ? Number.parseInt(variantId, 10) : variantId;
          if (Number.isNaN(externalVariantId)) {
            externalVariantId = 0;
          }
        }
      } else {
        externalVariantId = 0; // No variant
      }

      return {
        id: index + 1, // PrestaShop order_row IDs are sequential
        product_id: externalProductId,
        product_attribute_id: externalVariantId,
        product_quantity: item.quantity,
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
     * Calculate shipping totals for PrestaShop order
     *
     * PrestaShop requires separate fields for shipping with and without tax:
     * - total_shipping_tax_excl: Shipping cost without tax
     * - total_shipping_tax_incl: Shipping cost with tax
     *
     * Note: For now, we assume shipping tax is 0 (shipping tax is not provided in OrderCreate.totals).
     * Future enhancement: Add shippingTax field to OrderTotals if needed.
     */
    const totalShippingTaxExcl = orderCreate.totals.shipping;
    const totalShippingTaxIncl = orderCreate.totals.shipping; // Assuming no tax on shipping for now

    /**
     * Currency conversion rate
     *
     * PrestaShop uses conversion_rate to handle multi-currency orders.
     * For now, we default to 1.0 (assuming same currency or 1:1 conversion).
     * Future enhancement: Fetch actual conversion rate from PrestaShop if order currency
     * differs from shop default currency.
     */
    const conversionRate = 1.0;

    /**
     * Default values for PrestaShop order creation
     *
     * These defaults are used when values are not provided:
     * - id_currency: 1 (EUR - common default in PrestaShop)
     * - id_lang: 1 (first language - common default in PrestaShop)
     * - id_carrier: 1 (first carrier - common default in PrestaShop)
     * - module: 'ps_checkpayment' (Check payment - common default payment module)
     * - payment: 'Check payment' (Default payment method name)
     *
     * Future enhancement: Make these configurable via connection config or environment variables.
     */
    const DEFAULT_CURRENCY_ID = 1; // EUR
    const DEFAULT_LANGUAGE_ID = 1; // First language
    const DEFAULT_CARRIER_ID = 1; // First carrier
    const DEFAULT_PAYMENT_MODULE = 'ps_checkpayment';
    const DEFAULT_PAYMENT_METHOD = 'Check payment';

    // Build PrestaShop order structure
    const prestashopOrder: Record<string, unknown> = {
      id_customer: externalCustomerId,
      id_currency: externalCurrencyId || DEFAULT_CURRENCY_ID,
      id_lang: externalLangId || DEFAULT_LANGUAGE_ID,
      id_carrier: DEFAULT_CARRIER_ID,
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
      total_shipping: orderCreate.totals.shipping.toFixed(2),
      total_shipping_tax_incl: totalShippingTaxIncl.toFixed(2), // Shipping with tax
      total_shipping_tax_excl: totalShippingTaxExcl.toFixed(2), // Shipping without tax
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
        'Both shipping and billing addresses are missing. At least one address is required for PrestaShop order creation.',
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
  ): Record<string, unknown> {
    // Map cart rows (products)
    const cartRows = orderCreate.items.map((item, index) => {
      const externalProductId = externalProductIds.get(item.productId);
      if (!externalProductId) {
        // Log warning before throwing to help debug mapping issues
        this.logger.warn(
          `No external product ID found for internal product ID: ${item.productId}. ` +
            `This may indicate a missing product mapping or sync issue.`,
        );
        throw new PrestashopProvisioningException(
          `No external product ID found for internal product ID: ${item.productId}`,
          undefined,
          undefined,
        );
      }

      // Map variant ID if present
      let externalVariantId: number;
      if (item.variantId) {
        const variantId = externalVariantIds.get(item.variantId);
        if (variantId === undefined) {
          externalVariantId = 0;
        } else {
          // Ensure variant ID is a number
          externalVariantId = typeof variantId === 'string' ? Number.parseInt(variantId, 10) : variantId;
          if (Number.isNaN(externalVariantId)) {
            externalVariantId = 0;
          }
        }
      } else {
        externalVariantId = 0; // No variant
      }

      return {
        id: index + 1,
        id_product: externalProductId,
        id_product_attribute: externalVariantId,
        quantity: item.quantity,
      };
    });

    /**
     * Default values for PrestaShop cart creation (same as order defaults)
     */
    const DEFAULT_CURRENCY_ID = 1; // EUR
    const DEFAULT_LANGUAGE_ID = 1; // First language

    // Build PrestaShop cart structure
    const prestashopCart: Record<string, unknown> = {
      id_customer: externalCustomerId,
      id_currency: externalCurrencyId || DEFAULT_CURRENCY_ID,
      id_lang: externalLangId || DEFAULT_LANGUAGE_ID,
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
   * Map OpenLinker order status to PrestaShop status ID
   *
   * PrestaShop uses numeric status IDs. This maps common OpenLinker statuses
   * to PrestaShop defaults. In production, status IDs should be configurable
   * or fetched from PrestaShop.
   */
  private mapOrderStatusToPrestashop(status: string): number {
    // Common PrestaShop order status IDs (default installation)
    switch (status.toLowerCase()) {
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
      default:
        return 1; // Default to pending
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
      'total_shipping',
      'total_shipping_tax_incl',
      'total_shipping_tax_excl',
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
        `Required fields are missing in order data: ${missingFields.join(', ')}`,
      );
    }

    // Validate associations.order_rows exists and is not empty
    const associations = orderData.associations as Record<string, unknown>;
    if (!associations || !associations.order_rows) {
      throw new PrestashopProvisioningException(
        'Required field "associations.order_rows" is missing in order data',
      );
    }

    const orderRows = (associations.order_rows as Record<string, unknown>).order_row;
    if (!orderRows || (Array.isArray(orderRows) && orderRows.length === 0)) {
      throw new PrestashopProvisioningException(
        'Order must have at least one order row',
      );
    }
  }
}

