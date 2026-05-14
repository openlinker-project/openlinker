/**
 * Order Ingestion Service
 *
 * Core-owned marketplace order ingestion + routing orchestration.
 *
 * Responsibilities:
 * - Single-flight ingestion per connection (lock)
 * - Cursor read/commit safety
 * - Deterministic dedupe keys for downstream jobs
 * - Hydration of full order via OrderSourcePort and routing via OrderSyncService
 *
 * @module libs/core/src/orders/application/services
 */

import { Injectable, Inject } from '@nestjs/common';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OrderSourcePort } from '@openlinker/core/orders';
import {
  ConnectionCursorRepositoryPort,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
  SyncJobQueuePort,
  SYNC_JOB_QUEUE_TOKEN,
  SyncLockPort,
  SYNC_LOCK_TOKEN,
} from '@openlinker/core/sync';
import { IIdentifierMappingService, IDENTIFIER_MAPPING_SERVICE_TOKEN, CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import {
  ICustomerIdentityResolverService,
  CUSTOMER_IDENTITY_RESOLVER_SERVICE_TOKEN,
  IOrderCustomerProjectionUpdaterService,
  ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN,
} from '@openlinker/core/customers';
import { IOrderSyncService } from '../interfaces/order-sync.service.interface';
import type {
  IOrderIngestionService,
  OrderIngestionOptions,
  OrderIngestionResult,
} from '../interfaces/order-ingestion.service.interface';
import { ORDER_SYNC_SERVICE_TOKEN, ORDER_RECORD_SERVICE_TOKEN } from '../../orders.tokens';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import type { IncomingOrder } from '../../domain/types/incoming-order.types';
import type { Order } from '../../domain/types/order.types';
import { Logger } from '@openlinker/shared/logging';
import { OrderItemRefResolverService } from './order-item-ref-resolver.service';
import { MissingOrderItemMappingError } from '../../domain/exceptions/missing-order-item-mapping.error';

@Injectable()
export class OrderIngestionService implements IOrderIngestionService {
  private readonly logger = new Logger(OrderIngestionService.name);

  // Keep comfortably above worst-case poll+enqueue duration; we currently do not refresh TTL.
  private readonly LOCK_TTL_MS = 5 * 60_000;

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursorRepository: ConnectionCursorRepositoryPort,
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly lock: SyncLockPort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    private readonly orderItemRefResolver: OrderItemRefResolverService,
    @Inject(ORDER_SYNC_SERVICE_TOKEN)
    private readonly orderSyncService: IOrderSyncService,
    @Inject(CUSTOMER_IDENTITY_RESOLVER_SERVICE_TOKEN)
    private readonly customerIdentityResolver: ICustomerIdentityResolverService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService,
    @Inject(ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN)
    private readonly customerProjectionUpdater: IOrderCustomerProjectionUpdaterService
  ) {}

  async ingestOrders(
    connectionId: string,
    options: OrderIngestionOptions
  ): Promise<OrderIngestionResult> {
    const lockKey = `marketplace:orders:poll:${connectionId}`;
    const token = await this.lock.acquire(lockKey, this.LOCK_TTL_MS);
    if (!token) {
      this.logger.debug(`Skipping ingestion: lock not acquired (${lockKey})`);
      return {
        fetched: 0,
        enqueued: 0,
        nextCursor: null,
        committed: false,
        skippedDueToLock: true,
      };
    }

    try {
      const { cursorKey, limit, eventTypes } = options;
      const fromCursor = await this.cursorRepository.get(connectionId, cursorKey);

      const orderSource = await this.integrationsService.getCapabilityAdapter<OrderSourcePort>(
        connectionId,
        'OrderSource'
      );

      const feed = await orderSource.listOrderFeed({
        fromCursor,
        limit,
        eventTypes,
      });

      const requests = feed.items.map((item) => ({
        type: 'marketplace.order.sync' as const,
        connectionId,
        payload: {
          schemaVersion: 1 as const,
          externalOrderId: item.externalOrderId,
          sourceEventId: item.eventKey,
          eventType: item.eventType,
          occurredAt: item.occurredAt,
          eventKey: item.eventKey,
        },
        options: {
          dedupeKey: `marketplace:${connectionId}:order:${item.eventKey}`,
        },
      }));

      // Enqueue first; if enqueue fails, do not commit cursor.
      await this.jobQueue.enqueueBulk(requests);

      let committed = false;
      const nextCursor = feed.nextCursor;
      // Cursor monotonicity guard (best-effort):
      // - if adapter returns a cursor that "goes backwards" relative to current cursor, do not commit.
      // For MVP we only enforce this when both cursors look like Allegro event IDs (stringified integers or comparable).
      if (nextCursor && nextCursor.trim() !== '') {
        if (fromCursor && this.isCursorRegression(fromCursor, nextCursor)) {
          this.logger.warn(
            `Cursor regression detected; not committing cursor. cursorKey=${cursorKey}, fromCursor=${fromCursor}, nextCursor=${nextCursor} (connection: ${connectionId})`
          );
          return {
            fetched: feed.items.length,
            enqueued: requests.length,
            nextCursor,
            committed: false,
            skippedDueToLock: false,
          };
        }
        await this.cursorRepository.set(connectionId, cursorKey, nextCursor);
        committed = true;
      }

      return {
        fetched: feed.items.length,
        enqueued: requests.length,
        nextCursor,
        committed,
        skippedDueToLock: false,
      };
    } finally {
      await this.lock.release(lockKey, token);
    }
  }

  private isCursorRegression(previous: string, next: string): boolean {
    // Allegro event IDs are comparable as strings (lexicographic) because they are numeric-like,
    // but to be safer try numeric compare first when both parse.
    const prevNum = Number(previous);
    const nextNum = Number(next);
    if (Number.isFinite(prevNum) && Number.isFinite(nextNum)) {
      return nextNum < prevNum;
    }
    return next < previous;
  }

  async syncOrderFromSource(
    connectionId: string,
    externalOrderId: string,
    sourceEventId?: string
  ): Promise<ReturnType<IOrderSyncService['syncOrder']> extends Promise<infer T> ? T : never> {
    const orderSource = await this.integrationsService.getCapabilityAdapter<OrderSourcePort>(
      connectionId,
      'OrderSource'
    );

    const incoming = await orderSource.getOrder({ externalOrderId });

    // Step 1: resolve order + customer IDs (no item mapping yet)
    const internalOrderId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Order,
      incoming.externalOrderId,
      connectionId
    );

    const internalCustomerId = await this.resolveCustomerId(
      incoming,
      connectionId,
      internalOrderId
    );

    // Step 2: persist raw snapshot immediately — operator can see the order even if item resolution fails
    await this.orderRecordService.persistIncomingSnapshot(
      incoming,
      internalOrderId,
      internalCustomerId ?? null,
      connectionId,
      sourceEventId ?? null
    );

    // Step 3: attempt item resolution (non-throwing)
    const resolvedItems: Order['items'] = [];
    const unresolvedRefs: Array<{ itemId: string; reason: string }> = [];

    for (const item of incoming.items) {
      const result = await this.orderItemRefResolver.tryResolve(connectionId, item.productRef);
      if (result.resolved) {
        resolvedItems.push({
          id: item.id,
          productId: result.internalProductId,
          variantId: result.internalVariantId,
          quantity: item.quantity,
          price: item.price,
          sku: item.sku,
          name: item.name,
          imageUrl: item.imageUrl,
        });
      } else {
        unresolvedRefs.push({ itemId: item.id, reason: result.reason });
      }
    }

    // Step 4: if any unresolved, throw so the job runner retries with backoff
    if (unresolvedRefs.length > 0) {
      const first = unresolvedRefs[0];
      const firstItem = incoming.items.find((i) => i.id === first.itemId);
      throw new MissingOrderItemMappingError(
        connectionId,
        firstItem?.productRef ?? { type: 'offer', externalId: first.itemId },
        first.reason
      );
    }

    // Step 5: all items resolved — build unified order and upsert with recordStatus='ready'
    const order = this.buildUnifiedOrder(
      incoming,
      internalOrderId,
      internalCustomerId,
      resolvedItems
    );
    await this.orderRecordService.persistOrder(order, connectionId, sourceEventId ?? null);

    // Step 6: best-effort customer-projection sync. Runs before destination dispatch so
    // a destination failure can't drop projection updates. Failure here is swallowed —
    // projections are non-authoritative and must never block order sync.
    if (internalCustomerId) {
      try {
        await this.customerProjectionUpdater.updateProjectionsForOrder(
          order,
          internalCustomerId,
          connectionId
        );
      } catch (error) {
        this.logger.warn(
          `Failed to update customer projections for order ${order.id} (customer: ${internalCustomerId}, connection: ${connectionId}): ${(error as Error).message}`,
          error
        );
      }
    }

    const results = await this.orderSyncService.syncOrder({
      order,
      sourceConnectionId: connectionId,
      sourceEventId,
    });

    // Update per-destination sync status; allSettled — one failure doesn't block others
    const settlements = await Promise.allSettled(
      results.map((result) => {
        if (result.status === 'success') {
          return this.orderRecordService.updateSyncStatus(
            order.id,
            result.destinationConnectionId,
            {
              destinationConnectionId: result.destinationConnectionId,
              status: 'synced',
              syncedAt: new Date(),
              externalOrderId: result.orderRef.orderId,
              externalOrderNumber: result.orderRef.orderNumber,
            }
          );
        } else {
          return this.orderRecordService.updateSyncStatus(
            order.id,
            result.destinationConnectionId,
            {
              destinationConnectionId: result.destinationConnectionId,
              status: 'failed',
              error: result.error.message,
            }
          );
        }
      })
    );
    for (const settlement of settlements) {
      if (settlement.status === 'rejected') {
        this.logger.warn('Failed to update order record sync status', settlement.reason);
      }
    }

    return results;
  }

  private async resolveCustomerId(
    incoming: IncomingOrder,
    connectionId: string,
    internalOrderId: string
  ): Promise<string | undefined> {
    if (!incoming.customerExternalId) {
      return undefined;
    }
    if (incoming.customerEmail) {
      const resolution = await this.customerIdentityResolver.resolveCustomerIdentity({
        externalBuyerId: incoming.customerExternalId,
        email: incoming.customerEmail,
        sourceConnectionId: connectionId,
      });
      return resolution.internalCustomerId;
    }
    return this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Customer,
      incoming.customerExternalId,
      connectionId,
      { parentEntityType: CORE_ENTITY_TYPE.Order, parentInternalId: internalOrderId }
    );
  }

  private buildUnifiedOrder(
    incoming: IncomingOrder,
    internalOrderId: string,
    internalCustomerId: string | undefined,
    resolvedItems: Order['items']
  ): Order {
    return {
      id: internalOrderId,
      orderNumber: incoming.orderNumber,
      status: incoming.status,
      customerId: internalCustomerId,
      items: resolvedItems,
      totals: incoming.totals,
      shippingAddress: incoming.shippingAddress,
      billingAddress: incoming.billingAddress,
      shipping: incoming.shipping,
      pickupPoint: incoming.pickupPoint,
      createdAt: new Date(incoming.createdAt),
      updatedAt: new Date(incoming.updatedAt),
    };
  }
}
