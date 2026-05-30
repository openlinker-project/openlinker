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
import type {
  IOrderSyncService,
  OrderSyncRequest,
  OrderSyncResult,
} from '../interfaces/order-sync.service.interface';
import type { OrderProcessorManagerPort } from '../../domain/ports/order-processor-manager.port';
import type { OrderCreate, OrderRef } from '../../domain/types/order-processor.types';
import { OrderStatusValues } from '../../domain/types/order.types';
import { IIntegrationsService } from '@openlinker/core/integrations';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IMappingConfigService, MAPPING_CONFIG_SERVICE_TOKEN } from '@openlinker/core/mappings';
import { SyncLockPort, SYNC_LOCK_TOKEN } from '@openlinker/core/sync';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { NoOrderDestinationsAvailableException } from '../../domain/exceptions/no-order-destinations-available.exception';
import { OrderCreateContendedException } from '../../domain/exceptions/order-create-contended.exception';
import { ORDER_CREATE_LOCK_TTL_MS, orderCreateLockKey } from './order-create-lock';

@Injectable()
export class OrderSyncService implements IOrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(MAPPING_CONFIG_SERVICE_TOKEN)
    private readonly mappingConfigService: IMappingConfigService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService
  ) {}

  async syncOrder(request: OrderSyncRequest): Promise<OrderSyncResult[]> {
    const { order, sourceConnectionId, sourceEventId } = request;

    this.logger.log(
      `Syncing order ${order.id} from source connection ${sourceConnectionId}${sourceEventId ? ` (event: ${sourceEventId})` : ''}`
    );

    const destinations = await this.resolveDestinations(sourceConnectionId);

    if (destinations.length === 0) {
      throw new NoOrderDestinationsAvailableException(order.id, sourceConnectionId);
    }

    // Resolve status mapping once — identical across all destinations
    const resolvedStatus = await this.mappingConfigService.resolveStatusMapping(
      sourceConnectionId,
      order.status
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
        taxTreatment: order.totals.taxTreatment,
      },
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      shipping: order.shipping,
      pickupPoint: order.pickupPoint,
      source: { connectionId: sourceConnectionId, eventId: sourceEventId },
      metadata: {
        // Stamped once and shared across destinations: marks when OL started
        // dispatching this order, not per-destination completion time.
        syncedAt: new Date().toISOString(),
        internalOrderId: order.id,
      },
    };

    // Dispatch in parallel with per-destination error isolation. Each create is
    // serialized per (order, destination) by a lock so converging triggers
    // (webhook + poll, or a job retry) on multiple workers can't double-create.
    const settled = await Promise.allSettled(
      destinations.map(({ connectionId, adapter }) =>
        this.createOrderIdempotently(adapter, connectionId, order.id, orderCreate).then(
          (orderRef) => ({ connectionId, orderRef })
        )
      )
    );

    // Lock contention (a concurrent create is in-flight for the same order) is a
    // retryable condition, not a per-destination failure: rethrow so the sync
    // job retries (mirrors MissingOrderItemMappingError). By the retry the peer
    // worker has finished and the create is skipped.
    //
    // Note: the whole-job retry re-dispatches every destination, including ones
    // that already succeeded this run (they hit the adapter's skip path) and a
    // sibling that genuinely failed (re-attempted as a side effect). Both are
    // safe because create is idempotent; the already-succeeded skip currently
    // returns the internal id in the OrderRef — fixed when the mapping write +
    // OrderRef external-id contract move into core (#909).
    const contended = settled.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected' && outcome.reason instanceof OrderCreateContendedException
    );
    if (contended) {
      this.logger.warn(`Order ${order.id} create contended on a destination; retrying sync job`);
      throw contended.reason;
    }

    return settled.map((outcome, index): OrderSyncResult => {
      const destinationConnectionId = destinations[index].connectionId;

      if (outcome.status === 'fulfilled') {
        const { orderRef } = outcome.value;
        this.logger.log(
          `Order ${order.id} synced to destination ${destinationConnectionId} (destination order: ${orderRef.orderId}${orderRef.orderNumber ? `, orderNumber: ${orderRef.orderNumber}` : ''})`
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
        outcome.reason instanceof Error ? outcome.reason.stack : undefined
      );
      return {
        destinationConnectionId,
        status: 'failed',
        error: { message },
      };
    });
  }

  /**
   * Create one order at one destination under a per-(order, destination) lock.
   *
   * The lock removes the multi-worker race in the adapter's own check-then-act
   * create-or-skip (`sync-job.runner` locks per-job, not per-order). On
   * contention (lock held by a concurrent worker) we re-read the destination
   * mapping: if the peer already created the order we skip and synthesize the
   * ref from the mapping; otherwise we throw a retryable
   * `OrderCreateContendedException` so the sync job retries.
   */
  private async createOrderIdempotently(
    adapter: OrderProcessorManagerPort,
    destinationConnectionId: string,
    internalOrderId: string,
    orderCreate: OrderCreate
  ): Promise<OrderRef> {
    const lockKey = orderCreateLockKey(destinationConnectionId, internalOrderId);
    const token = await this.syncLock.acquire(lockKey, ORDER_CREATE_LOCK_TTL_MS);

    if (!token) {
      const mappings = await this.identifierMapping.getExternalIds(
        CORE_ENTITY_TYPE.Order,
        internalOrderId
      );
      const existing = mappings.find((m) => m.connectionId === destinationConnectionId);
      if (existing) {
        this.logger.log(
          `Order ${internalOrderId} already present at destination ${destinationConnectionId} ` +
            `(concurrent create resolved); skipping create`
        );
        return { orderId: existing.externalId };
      }
      throw new OrderCreateContendedException(internalOrderId, destinationConnectionId);
    }

    try {
      return await adapter.createOrder(orderCreate);
    } finally {
      // Best-effort release — never let a release failure mask the create result.
      try {
        await this.syncLock.release(lockKey, token);
      } catch (releaseError) {
        this.logger.warn(
          `Failed to release order-create lock ${lockKey}: ` +
            `${releaseError instanceof Error ? releaseError.message : String(releaseError)}`
        );
      }
    }
  }

  private async resolveDestinations(
    sourceConnectionId: string
  ): Promise<Array<{ connectionId: string; adapter: OrderProcessorManagerPort }>> {
    const resolved =
      await this.integrationsService.listCapabilityAdapters<OrderProcessorManagerPort>({
        capability: 'OrderProcessorManager',
      });

    return resolved
      .filter(({ connectionId }) => connectionId !== sourceConnectionId)
      .map(({ connectionId, adapter }) => ({ connectionId, adapter }));
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
