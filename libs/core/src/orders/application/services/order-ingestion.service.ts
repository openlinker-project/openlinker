/**
 * Order Ingestion Service
 *
 * Core-owned marketplace order ingestion + routing orchestration.
 *
 * Responsibilities:
 * - Single-flight ingestion per connection (lock)
 * - Cursor read/commit safety
 * - Deterministic dedupe keys for downstream jobs
 * - Hydration of full order via MarketplacePort and routing via OrderSyncService
 *
 * @module libs/core/src/orders/application/services
 */

import { Injectable, Inject } from '@nestjs/common';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
  MarketplacePort,
} from '@openlinker/core/integrations';
import {
  ConnectionCursorRepositoryPort,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
  SyncJobQueuePort,
  SYNC_JOB_QUEUE_TOKEN,
  SyncLockPort,
  SYNC_LOCK_TOKEN,
} from '@openlinker/core/sync';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
import {
  ICustomerIdentityResolverService,
  CUSTOMER_IDENTITY_RESOLVER_SERVICE_TOKEN,
} from '@openlinker/core/customers';
import { IOrderSyncService } from '../interfaces/order-sync.service.interface';
import {
  IOrderIngestionService,
  MarketplaceIngestionOptions,
  MarketplaceIngestionResult,
} from '../interfaces/order-ingestion.service.interface';
import { ORDER_SYNC_SERVICE_TOKEN } from '../../orders.tokens';
import type { IncomingOrder } from '../../domain/types/incoming-order.types';
import { Order } from '../../domain/ports/order-source.port';
import { Logger } from '@openlinker/shared/logging';
import { OrderItemRefResolverService } from './order-item-ref-resolver.service';

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
  ) {}

  async syncFromMarketplace(
    connectionId: string,
    options: MarketplaceIngestionOptions,
  ): Promise<MarketplaceIngestionResult> {
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

      const marketplace = await this.integrationsService.getCapabilityAdapter<MarketplacePort>(
        connectionId,
        'Marketplace',
      );

      const feed = await marketplace.listOrderFeed({
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
            `Cursor regression detected; not committing cursor. cursorKey=${cursorKey}, fromCursor=${fromCursor}, nextCursor=${nextCursor} (connection: ${connectionId})`,
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

  async syncOrderFromMarketplace(
    connectionId: string,
    externalOrderId: string,
    sourceEventId?: string,
  ): Promise<ReturnType<IOrderSyncService['syncOrder']> extends Promise<infer T> ? T : never> {
    const marketplace = await this.integrationsService.getCapabilityAdapter<MarketplacePort>(
      connectionId,
      'Marketplace',
    );

    const incoming = await marketplace.getOrder({ externalOrderId });
    const order = await this.toUnifiedOrder(incoming, connectionId);
    return await this.orderSyncService.syncOrder({
      order,
      sourceConnectionId: connectionId,
      sourceEventId,
    });
  }

  private async toUnifiedOrder(incoming: IncomingOrder, connectionId: string): Promise<Order> {
    // Order id: map marketplace externalOrderId -> internal OpenLinker order id
    const internalOrderId = await this.identifierMapping.getOrCreateInternalId(
      'Order',
      incoming.externalOrderId,
      connectionId,
    );

    let internalCustomerId: string | undefined;
    if (incoming.customerExternalId) {
      if (incoming.customerEmail) {
        // Use identity resolver: creates/updates customer projection with email
        const resolution = await this.customerIdentityResolver.resolveCustomerIdentity({
          externalBuyerId: incoming.customerExternalId,
          email: incoming.customerEmail,
          sourceConnectionId: connectionId,
        });
        internalCustomerId = resolution.internalCustomerId;
      } else {
        internalCustomerId = await this.identifierMapping.getOrCreateInternalId(
          'Customer',
          incoming.customerExternalId,
          connectionId,
          { parentEntityType: 'Order', parentInternalId: internalOrderId },
        );
      }
    }

    const items: Order['items'] = [];
    for (const item of incoming.items) {
      const resolved = await this.orderItemRefResolver.resolve(connectionId, item.productRef);

      items.push({
        id: item.id,
        productId: resolved.internalProductId,
        variantId: resolved.internalVariantId,
        quantity: item.quantity,
        price: item.price,
        sku: item.sku,
      });
    }

    const order: Order = {
      id: internalOrderId,
      orderNumber: incoming.orderNumber,
      status: incoming.status,
      customerId: internalCustomerId,
      items,
      totals: incoming.totals,
      shippingAddress: incoming.shippingAddress,
      billingAddress: incoming.billingAddress,
      createdAt: new Date(incoming.createdAt),
      updatedAt: new Date(incoming.updatedAt),
    };

    return order;
  }
}

