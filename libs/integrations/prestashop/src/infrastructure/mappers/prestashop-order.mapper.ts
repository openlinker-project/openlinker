/**
 * PrestaShop Order Mapper
 *
 * Maps PrestaShop order and order_detail data to OpenLinker Order schema.
 * Handles customer information, addresses, line items, and totals.
 * Also maps OpenLinker OrderCreate to the PrestaShop CART the order-processor
 * adapter creates before handing off to the OL module's `importorder`
 * endpoint, where PrestaShop's own `validateOrder` builds the order (ADR-016 /
 * #905). The raw-webservice order body this mapper used to build was removed
 * with #2102 - see ADR-016 for why that surface no longer exists.
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
 * Default values for PrestaShop cart creation. Kept at module scope as the
 * single source of truth. Future enhancement: move to connection config so
 * per-store overrides don't require a code change.
 */
const DEFAULT_CURRENCY_ID = 1; // EUR
const DEFAULT_LANGUAGE_ID = 1; // First language
const DEFAULT_CARRIER_ID = 1; // First carrier

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

    // Build PrestaShop cart structure. id_carrier is set here because PS
    // resolves the order's carrier from the cart (#503).
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
}
