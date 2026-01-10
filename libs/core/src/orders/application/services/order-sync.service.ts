/**
 * Order Sync Service
 *
 * Application service for synchronizing orders from sources to destination processors.
 * Routes unified orders (with internal IDs) to configured OrderProcessorManager adapters.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderSyncService}
 * @see {@link IOrderSyncService} for the service interface
 * @see {@link OrderProcessorManagerPort} for destination processor port
 * @see {@link IIntegrationsService} for adapter resolution
 */
import { Injectable, Inject } from '@nestjs/common';
import { IOrderSyncService, OrderSyncRequest, OrderSyncResult } from '../interfaces/order-sync.service.interface';
import { OrderProcessorManagerPort } from '../../domain/ports/order-processor-manager.port';
import { OrderCreate } from '../../domain/types/order-processor.types';
import { OrderStatusValues } from '../../domain/types/order.types';
import { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations/integrations.tokens';
import { Logger } from '@openlinker/shared/logging';

/**
 * Order Sync Service
 *
 * Routes orders from sources (e.g., Allegro) to destination processors (e.g., PrestaShop).
 * For MVP, uses a single configured destination connection ID from environment variable.
 */
@Injectable()
export class OrderSyncService implements IOrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name);
  private readonly destinationConnectionId: string | null;

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
  ) {
    // MVP: Read destination connection ID from environment variable
    // TODO: Phase 8+ - Support multiple destinations, connection-based routing, etc.
    this.destinationConnectionId = process.env.ORDER_SYNC_DESTINATION_CONNECTION_ID || null;

    if (!this.destinationConnectionId) {
      this.logger.warn(
        'ORDER_SYNC_DESTINATION_CONNECTION_ID not configured. Order sync will fail until configured.',
      );
    } else {
      this.logger.log(
        `OrderSyncService initialized with destination connection: ${this.destinationConnectionId}`,
      );
    }
  }

  async syncOrder(request: OrderSyncRequest): Promise<OrderSyncResult[]> {
    const { order, sourceConnectionId, sourceEventId } = request;

    this.logger.log(
      `Syncing order ${order.id} from source connection ${sourceConnectionId}${sourceEventId ? ` (event: ${sourceEventId})` : ''}`,
    );

    if (!this.destinationConnectionId) {
      throw new Error(
        'ORDER_SYNC_DESTINATION_CONNECTION_ID not configured. Set the environment variable to enable order sync.',
      );
    }

    // Resolve destination OrderProcessorManager adapter
    const processorAdapter = await this.integrationsService.getCapabilityAdapter<OrderProcessorManagerPort>(
      this.destinationConnectionId,
      'OrderProcessorManager',
    );

    this.logger.debug(
      `Resolved OrderProcessorManager adapter for destination connection ${this.destinationConnectionId}`,
    );

    // Map unified Order to OrderCreate request
    // Validate and map order status to OrderStatus type
    const orderStatus = this.validateOrderStatus(order.status);
    const orderCreate: OrderCreate = {
      orderNumber: order.orderNumber,
      status: orderStatus,
      customerId: order.customerId,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        price: item.price,
        sku: item.sku,
      })),
      totals: {
        subtotal: order.totals.subtotal,
        tax: order.totals.tax,
        shipping: order.totals.shipping,
        total: order.totals.total,
        currency: order.totals.currency,
      },
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      metadata: {
        sourceConnectionId,
        sourceEventId,
        syncedAt: new Date().toISOString(),
      },
    };

    // Create order in destination system
    this.logger.debug(`Creating order in destination system (connection: ${this.destinationConnectionId})`);
    const orderRef = await processorAdapter.createOrder(orderCreate);

    this.logger.log(
      `Order ${order.id} synced successfully to destination ${this.destinationConnectionId} (destination order: ${orderRef.orderId}${orderRef.orderNumber ? `, orderNumber: ${orderRef.orderNumber}` : ''})`,
    );

    return [
      {
        destinationConnectionId: this.destinationConnectionId,
        orderRef,
      },
    ];
  }

  /**
   * Validate and map order status string to OrderStatus type
   *
   * Ensures type safety when mapping from Order (string status) to OrderCreate (OrderStatus union).
   * Defaults to 'pending' if status is not recognized.
   *
   * @param status - Order status string
   * @returns Validated OrderStatus
   */
  private validateOrderStatus(status: string): OrderCreate['status'] {
    if (OrderStatusValues.includes(status as OrderCreate['status'])) {
      return status as OrderCreate['status'];
    }
    this.logger.warn(
      `Unknown order status: ${status}, defaulting to 'pending'`,
    );
    return 'pending';
  }
}

