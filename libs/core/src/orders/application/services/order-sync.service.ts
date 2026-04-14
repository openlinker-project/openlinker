/**
 * Order Sync Service
 *
 * Application service for synchronizing orders from sources to destination processors.
 * Routes unified orders (with internal IDs) to every active connection whose adapter
 * supports the `OrderProcessorManager` capability, with per-destination error isolation.
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
import { IMappingConfigService, MAPPING_CONFIG_SERVICE_TOKEN } from '@openlinker/core/mappings';
import { Logger } from '@openlinker/shared/logging';

/**
 * Order Sync Service
 *
 * Routes orders from sources (e.g. Allegro) to every configured
 * `OrderProcessorManager` destination (e.g. PrestaShop + secondary WMS).
 *
 * The optional env var `ORDER_SYNC_DESTINATION_CONNECTION_ID` acts as a
 * single-destination allowlist filter (legacy MVP behavior) — when set, only
 * that connection ID is dispatched to, even if more processors are registered.
 */
@Injectable()
export class OrderSyncService implements IOrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name);
  private readonly destinationConnectionIdOverride: string | null;

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(MAPPING_CONFIG_SERVICE_TOKEN)
    private readonly mappingConfigService: IMappingConfigService,
  ) {
    this.destinationConnectionIdOverride = process.env.ORDER_SYNC_DESTINATION_CONNECTION_ID || null;

    if (this.destinationConnectionIdOverride) {
      this.logger.log(
        `OrderSyncService: single-destination override active for connection ${this.destinationConnectionIdOverride}`,
      );
    }
  }

  async syncOrder(request: OrderSyncRequest): Promise<OrderSyncResult[]> {
    const { order, sourceConnectionId, sourceEventId } = request;

    this.logger.log(
      `Syncing order ${order.id} from source connection ${sourceConnectionId}${sourceEventId ? ` (event: ${sourceEventId})` : ''}`,
    );

    const destinations = await this.resolveDestinations(sourceConnectionId);

    if (destinations.length === 0) {
      throw new Error(
        `No OrderProcessorManager destinations available for order ${order.id} (sourceConnectionId=${sourceConnectionId})`,
      );
    }

    // Resolve status mapping once — identical across all destinations
    const resolvedStatus = await this.mappingConfigService.resolveStatusMapping(
      sourceConnectionId,
      order.status,
    );
    const orderStatus = resolvedStatus
      ? this.validateOrderStatus(resolvedStatus)
      : this.validateOrderStatus(order.status);

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
        internalOrderId: order.id,
      },
    };

    // Dispatch in parallel with per-destination error isolation
    const settled = await Promise.allSettled(
      destinations.map(({ connectionId, adapter }) =>
        adapter
          .createOrder(orderCreate)
          .then((orderRef) => ({ connectionId, orderRef })),
      ),
    );

    return settled.map((outcome, index): OrderSyncResult => {
      const destinationConnectionId = destinations[index].connectionId;

      if (outcome.status === 'fulfilled') {
        const { orderRef } = outcome.value;
        this.logger.log(
          `Order ${order.id} synced to destination ${destinationConnectionId} (destination order: ${orderRef.orderId}${orderRef.orderNumber ? `, orderNumber: ${orderRef.orderNumber}` : ''})`,
        );
        return {
          destinationConnectionId,
          status: 'success',
          orderRef,
        };
      }

      const message =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      this.logger.error(
        `Order ${order.id} failed to sync to destination ${destinationConnectionId}: ${message}`,
        outcome.reason instanceof Error ? outcome.reason.stack : undefined,
      );
      return {
        destinationConnectionId,
        status: 'failed',
        error: { message },
      };
    });
  }

  /**
   * Resolve all active `OrderProcessorManager` destinations for this sync.
   *
   * - Excludes the source connection (never route an order back to its origin)
   * - If `ORDER_SYNC_DESTINATION_CONNECTION_ID` is set, narrows the result to
   *   that single connection (legacy single-destination override)
   */
  private async resolveDestinations(
    sourceConnectionId: string,
  ): Promise<Array<{ connectionId: string; adapter: OrderProcessorManagerPort }>> {
    const resolved = await this.integrationsService.listCapabilityAdapters<OrderProcessorManagerPort>({
      capability: 'OrderProcessorManager',
    });

    const filtered = resolved
      .filter(({ connectionId }) => connectionId !== sourceConnectionId)
      .filter(({ connectionId }) =>
        this.destinationConnectionIdOverride
          ? connectionId === this.destinationConnectionIdOverride
          : true,
      );

    return filtered.map(({ connectionId, adapter }) => ({ connectionId, adapter }));
  }

  /**
   * Validate and map order status string to OrderStatus type
   *
   * Ensures type safety when mapping from Order (string status) to OrderCreate (OrderStatus union).
   * Defaults to 'pending' if status is not recognized.
   */
  private validateOrderStatus(status: string): OrderCreate['status'] {
    if (OrderStatusValues.includes(status as OrderCreate['status'])) {
      return status as OrderCreate['status'];
    }
    this.logger.warn(`Unknown order status: ${status}, defaulting to 'pending'`);
    return 'pending';
  }
}
