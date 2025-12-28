/**
 * PrestaShop Order Mapper
 *
 * Maps PrestaShop order and order_detail data to OpenLinker Order schema.
 * Handles customer information, addresses, line items, and totals.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 * @implements {IPrestashopOrderMapper}
 */
import { IPrestashopOrderMapper, PrestashopOrder, PrestashopOrderRow } from './prestashop.mapper.interface';
import { Order, OrderItem, OrderTotals } from '@openlinker/core/orders';

/**
 * PrestaShop Order Mapper
 *
 * Transforms PrestaShop order data to OpenLinker Order schema.
 */
export class PrestashopOrderMapper implements IPrestashopOrderMapper {
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
}

