/**
 * PrestaShop Order Source Adapter
 *
 * Implements OrderSourcePort for PrestaShop WebService API. Provides read-only
 * access to PrestaShop orders. This adapter enables PrestaShop as an order source
 * alongside other sources (e.g., Allegro).
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {OrderSourcePort}
 */
import { OrderSourcePort, Order, OrderItem, OrderFilters } from '@openlinker/core/orders';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { IPrestashopOrderMapper, PrestashopOrder, PrestashopOrderRow } from '../mappers/prestashop.mapper.interface';
import { PrestashopResourceNotFoundException } from '@openlinker/integrations-prestashop';
import { Logger } from '@openlinker/shared/logging';

/**
 * PrestaShop Order Source Adapter
 *
 * Read-only adapter for fetching orders from PrestaShop.
 */
export class PrestashopOrderSourceAdapter implements OrderSourcePort {
  private readonly logger = new Logger(PrestashopOrderSourceAdapter.name);

  constructor(
    private readonly httpClient: IPrestashopWebserviceClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly orderMapper: IPrestashopOrderMapper,
    private readonly connection: Connection,
  ) {}

  async getOrders(filters: OrderFilters): Promise<Order[]> {
    this.logger.debug(`Getting orders with filters (connection: ${this.connection.id})`);

    // Build PrestaShop filters
    const prestashopFilters = this.buildPrestashopFilters(filters);

    // Fetch orders from PrestaShop
    const prestashopOrders = await this.httpClient.listResources<PrestashopOrder>(
      'orders',
      prestashopFilters,
      filters.limit,
      filters.offset,
    );

    if (prestashopOrders.length === 0) {
      return [];
    }

    // Batch identifier mapping for orders
    const orderMappingRequests = prestashopOrders.map((o) => ({
      entityType: 'Order' as const,
      externalId: String(o.id),
      connectionId: this.connection.id,
    }));

    const orderIdMap = await this.identifierMapping.batchGetOrCreateInternalIds(orderMappingRequests);

    // Fetch order details (order_rows) for each order
    const ordersWithDetails = await Promise.all(
      prestashopOrders.map(async (prestashopOrder) => {
        const externalOrderId = String(prestashopOrder.id);
        const internalOrderId =
          orderIdMap.get(`${externalOrderId}:${this.connection.id}`) || orderIdMap.get(externalOrderId) || '';

        if (!internalOrderId) {
          this.logger.warn(`No internal ID mapped for external order: ${externalOrderId}`);
          return null;
        }

        // Fetch order details (order_rows)
        const orderRows = await this.fetchOrderRows(externalOrderId);

        // Map order
        const mapped = this.orderMapper.mapOrder(prestashopOrder, orderRows);

        // Map line items' product/variant IDs to internal IDs
        const mappedItems = await Promise.all(
          mapped.items.map(async (item: OrderItem, index: number) => {
            const orderRow = orderRows[index];
            if (!orderRow) {
              return item;
            }

            // Map product ID
            if (orderRow.product_id) {
              const productInternalId = await this.identifierMapping.getOrCreateInternalId(
                'Product',
                String(orderRow.product_id),
                this.connection.id,
                {
                  parentEntityType: 'Order',
                  parentInternalId: internalOrderId,
                },
              );
              item.productId = productInternalId;
            }

            // Map variant ID if present
            // Note: ProductVariant is not a separate EntityType, we use Product with context
            if (orderRow.product_attribute_id && orderRow.product_attribute_id !== '0') {
              // For variants, we'll store the variant ID in metadata and use Product entity type
              // The variant ID will be stored as part of the product mapping context
              item.variantId = String(orderRow.product_attribute_id); // Keep external ID for now
              // TODO: Consider adding ProductVariant to EntityType or handle via metadata
            }

            return item;
          }),
        );

        return {
          ...mapped,
          id: internalOrderId,
          items: mappedItems,
        };
      }),
    );

    return ordersWithDetails.filter((o): o is Order => o !== null);
  }

  async getOrder(orderId: string): Promise<Order> {
    this.logger.debug(`Getting order: ${orderId} (connection: ${this.connection.id})`);

    // Resolve internal ID → external ID
    const externalIds = await this.identifierMapping.getExternalIds('Order', orderId);
    const prestashopOrderId = externalIds.find((e: { connectionId: string }) => e.connectionId === this.connection.id);

    if (!prestashopOrderId) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const error = new PrestashopResourceNotFoundException(
        `Order not found: ${orderId} (no external ID mapping for connection ${this.connection.id})`,
        'Order',
        orderId,
        this.connection.id,
      );
      throw error;
    }

    // Fetch order from PrestaShop
    const prestashopOrder = await this.httpClient.getResource<PrestashopOrder>('orders', prestashopOrderId.externalId);

    // Fetch order details (order_rows)
    const orderRows = await this.fetchOrderRows(prestashopOrderId.externalId);

    // Map order
    const mapped = this.orderMapper.mapOrder(prestashopOrder, orderRows);

    // Map line items' product/variant IDs to internal IDs
    const mappedItems = await Promise.all(
      mapped.items.map(async (item: OrderItem, index: number) => {
        const orderRow = orderRows[index];
        if (!orderRow) {
          return item;
        }

        // Map product ID
        if (orderRow.product_id) {
          const productInternalId = await this.identifierMapping.getOrCreateInternalId(
            'Product',
            String(orderRow.product_id),
            this.connection.id,
            {
              parentEntityType: 'Order',
              parentInternalId: orderId,
            },
          );
          item.productId = productInternalId;
        }

        // Map variant ID if present
        // Note: ProductVariant is not a separate EntityType, we use Product with context
        if (orderRow.product_attribute_id && orderRow.product_attribute_id !== '0') {
          // For variants, we'll store the variant ID in metadata and use Product entity type
          // The variant ID will be stored as part of the product mapping context
          item.variantId = String(orderRow.product_attribute_id); // Keep external ID for now
          // TODO: Consider adding ProductVariant to EntityType or handle via metadata
        }

        return item;
      }),
    );

    return {
      ...mapped,
      id: orderId,
      items: mappedItems,
    };
  }

  /**
   * Fetch order rows (order_details) for an order
   *
   * @param orderId - PrestaShop order ID (external)
   * @returns Array of order rows
   */
  private async fetchOrderRows(orderId: string | number): Promise<PrestashopOrderRow[]> {
    try {
      // PrestaShop stores order details in order_rows resource
      const orderRows = await this.httpClient.listResources<PrestashopOrderRow>('order_rows', {
        custom: {
          id_order: orderId,
        },
      });
      return orderRows;
    } catch (error) {
      this.logger.warn(`Failed to fetch order rows for order ${orderId}: ${(error as Error).message}`);
      // Return empty array if order rows can't be fetched
      return [];
    }
  }

  /**
   * Build PrestaShop filters from OrderFilters
   */
  private buildPrestashopFilters(filters: OrderFilters): {
    dateFrom?: Date;
    dateTo?: Date;
    updatedSince?: Date;
    status?: string | string[];
  } {
    const prestashopFilters: {
      dateFrom?: Date;
      dateTo?: Date;
      updatedSince?: Date;
      status?: string | string[];
    } = {};

    if (filters.dateFrom) {
      prestashopFilters.dateFrom = filters.dateFrom;
    }

    if (filters.dateTo) {
      prestashopFilters.dateTo = filters.dateTo;
    }

    if (filters.updatedSince) {
      prestashopFilters.updatedSince = filters.updatedSince;
    }

    if (filters.status) {
      // Map OpenLinker status to PrestaShop status IDs
      // For MVP, we'll pass status as-is (PrestaShop uses numeric IDs)
      const statusArray = Array.isArray(filters.status) ? filters.status : [filters.status];
      prestashopFilters.status = statusArray.map(String);
    }

    return prestashopFilters;
  }
}

