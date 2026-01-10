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
  ): Record<string, unknown> {
    // Map order status to PrestaShop status ID
    // PrestaShop uses numeric status IDs. For MVP, we'll use common defaults:
    // 1 = pending, 2 = payment accepted, 3 = preparation in progress, etc.
    const statusId = this.mapOrderStatusToPrestashop(orderCreate.status);

    // Map order rows (line items)
    const orderRows = orderCreate.items.map((item, index) => {
      const externalProductId = externalProductIds.get(item.productId);
      if (!externalProductId) {
        throw new Error(`No external product ID found for internal product ID: ${item.productId}`);
      }

      // Map variant ID if present
      let externalVariantId: string | number | undefined;
      if (item.variantId) {
        externalVariantId = externalVariantIds.get(item.variantId);
        // If variant mapping not found, use 0 (no variant) or throw error
        if (externalVariantId === undefined) {
          // For MVP, we'll allow missing variant mappings and use 0
          externalVariantId = 0;
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

    // Build PrestaShop order structure
    const prestashopOrder: Record<string, unknown> = {
      id_customer: externalCustomerId,
      current_state: statusId,
      reference: orderCreate.orderNumber || undefined,
      total_paid: orderCreate.totals.total.toFixed(2),
      total_paid_tax_incl: orderCreate.totals.total.toFixed(2),
      total_paid_tax_excl: orderCreate.totals.subtotal.toFixed(2),
      total_shipping: orderCreate.totals.shipping.toFixed(2),
      // PrestaShop requires associations for order_rows
      associations: {
        order_rows: {
          order_row: orderRows,
        },
      },
    };

    // Add addresses if provided (PrestaShop requires address IDs, not full address objects)
    // For MVP, we'll skip address mapping as it requires creating addresses first
    // This can be enhanced in future iterations

    return prestashopOrder;
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
}

