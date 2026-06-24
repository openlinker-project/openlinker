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
 * @see {@link ISyncCursorsService} for the cross-context cursor seam (#718)
 */

import { Injectable, Inject } from '@nestjs/common';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OrderSourcePort } from '@openlinker/core/orders';
import {
  ISyncCursorsService,
  SYNC_CURSORS_SERVICE_TOKEN,
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
import {
  ORDER_SYNC_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN,
  ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
} from '../../orders.tokens';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import { IOrderItemRefResolverService } from '../interfaces/order-item-ref-resolver.service.interface';
import { IOrderLifecycleRelayService } from '../interfaces/order-lifecycle-relay.service.interface';
import type { IncomingOrder } from '../../domain/types/incoming-order.types';
import type { Order } from '../../domain/types/order.types';
import type { OrderFeedEventType } from '../../domain/types/order-feed.types';
import type { OrderRecord } from '../../domain/entities/order-record.entity';
import { Logger } from '@openlinker/shared/logging';
import { MissingOrderItemMappingError } from '../../domain/exceptions/missing-order-item-mapping.error';

@Injectable()
export class OrderIngestionService implements IOrderIngestionService {
  private readonly logger = new Logger(OrderIngestionService.name);

  // Keep comfortably above worst-case poll+enqueue duration; we currently do not refresh TTL.
  private readonly LOCK_TTL_MS = 5 * 60_000;

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly syncCursors: ISyncCursorsService,
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly lock: SyncLockPort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN)
    private readonly orderItemRefResolver: IOrderItemRefResolverService,
    @Inject(ORDER_SYNC_SERVICE_TOKEN)
    private readonly orderSyncService: IOrderSyncService,
    @Inject(CUSTOMER_IDENTITY_RESOLVER_SERVICE_TOKEN)
    private readonly customerIdentityResolver: ICustomerIdentityResolverService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService,
    @Inject(ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN)
    private readonly customerProjectionUpdater: IOrderCustomerProjectionUpdaterService,
    @Inject(ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN)
    private readonly orderLifecycleRelay: IOrderLifecycleRelayService
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
      const fromCursor = await this.syncCursors.getCursor(connectionId, cursorKey);

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
        await this.syncCursors.advanceCursor(connectionId, cursorKey, nextCursor);
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
    sourceEventId?: string,
    eventType?: OrderFeedEventType
  ): Promise<ReturnType<IOrderSyncService['syncOrder']> extends Promise<infer T> ? T : never> {
    // Inbound cancellation (#1158): a source `cancelled` event must NOT re-run the
    // create/update path (which would re-create the order — the #1132 bug). Route
    // it through the lifecycle relay, which propagates the cancel to the order's
    // destination(s) via OrderStatusWriteback. OL owns no canonical status here —
    // it forwards the source's fact to the participants it already synced to.
    if (eventType === 'cancelled') {
      return this.handleSourceCancellation(connectionId, externalOrderId);
    }

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

    // Destination-echo guard (#940 / ADR-017): if an internal order already
    // exists for this external id and it originated from a DIFFERENT connection,
    // this is a re-read of an order OpenLinker itself created here as a sync
    // destination (e.g. the PrestaShop reconciliation poll re-reading an
    // Allegro-origin order it pushed in). Re-ingesting would overwrite the
    // order's true source, source event id and snapshot, and reset its sync
    // history — so skip. The real source stays authoritative; destination-side
    // fulfillment flows through the dedicated *.statusSync jobs (which key on
    // destinationConnectionId, not the source) and is unaffected.
    const existing = await this.orderRecordService.getOrderRecord(internalOrderId);
    if (existing && existing.sourceConnectionId !== connectionId) {
      // `debug` not `log`: this is an expected, per-order steady-state skip that
      // fires for every cross-origin order on each poll within the watermark
      // window — emitting it at info level would be production noise.
      this.logger.debug(
        `Skipping destination-echo re-ingestion of order ${internalOrderId}: ` +
          `external id ${incoming.externalOrderId} on connection ${connectionId} ` +
          `maps to an order originating from ${existing.sourceConnectionId}`
      );
      return [];
    }

    // Cancellation-observe hook (#1146): capture the prior business status from
    // the PRE-persist `existing` snapshot, before persistOrder overwrites it.
    // Defensive string read — mirrors the `OrderRecord.paymentStatus` getter
    // idiom; an absent/garbled prior status reads as non-cancelled (allowed to
    // fire once on a first-seen already-cancelled order — the restore is a
    // harmless absolute-set).
    const priorStatus = this.readSnapshotStatus(existing);

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

    // Cancellation-observe hook (#1146): on the `→ cancelled` transition, enqueue
    // a marketplace.offer.stockRestore job so the destination marketplace's
    // stock is restored (e.g. Erli auto-decrements on purchase but does not
    // restore on cancel — ADR-025 §4a). Transition-gated (priorStatus !==
    // 'cancelled') so a re-poll within the watermark window doesn't re-fire;
    // the dedupeKey makes any re-enqueue safe. Marketplace-agnostic — the worker
    // handler narrows the source connection's adapter to OfferStockRestorer and
    // no-ops if the capability is absent.
    if (order.status === 'cancelled' && priorStatus !== 'cancelled') {
      try {
        await this.jobQueue.enqueue({
          type: 'marketplace.offer.stockRestore',
          connectionId,
          payload: {
            schemaVersion: 1,
            internalOrderId,
          },
          options: {
            dedupeKey: `marketplace:${connectionId}:stockRestore:${internalOrderId}`,
          },
        });
      } catch (error) {
        // The order is already persisted as `cancelled`, so the transition gate
        // above won't re-fire on a re-poll — a swallowed enqueue failure would
        // silently lose the restore. We don't rethrow (that would fail the whole
        // order-sync and still couldn't re-fire the gate on retry), but we log at
        // error so the missed restore is loud and actionable.
        this.logger.error(
          `Failed to enqueue stock-restore job for cancelled order [connectionId=${connectionId}, orderId=${internalOrderId}]; marketplace stock will NOT be auto-restored`,
          (error as Error).stack,
        );
      }
    }

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

  /**
   * Inbound source cancellation → destination(s) via the lifecycle relay (#1158).
   * Resolves the existing internal order; if unknown (never ingested) there is
   * nothing to cancel. Applies the same destination-echo guard as ingestion
   * (ADR-017) so a re-read of an order OL itself created elsewhere doesn't
   * propagate a spurious cancel. Returns an empty result set — a cancel is not
   * an order-create, so there are no OrderSyncResults to report.
   */
  private async handleSourceCancellation(
    connectionId: string,
    externalOrderId: string
  ): Promise<never[]> {
    const internalOrderId = await this.identifierMapping.getInternalId(
      CORE_ENTITY_TYPE.Order,
      externalOrderId,
      connectionId
    );
    if (!internalOrderId) {
      this.logger.warn(
        `Cancellation for unknown order: external ${externalOrderId} on connection ${connectionId} ` +
          `has no internal mapping — nothing to cancel`
      );
      return [];
    }

    const existing = await this.orderRecordService.getOrderRecord(internalOrderId);
    if (existing && existing.sourceConnectionId !== connectionId) {
      // Destination-echo guard (ADR-017): a cancel re-read from a connection OL
      // pushed the order INTO is not the authoritative source's cancel — skip.
      this.logger.debug(
        `Skipping destination-echo cancellation of order ${internalOrderId}: external id ` +
          `${externalOrderId} on connection ${connectionId} maps to an order originating from ` +
          `${existing.sourceConnectionId}`
      );
      return [];
    }

    const result = await this.orderLifecycleRelay.relay({
      internalOrderId,
      originConnectionId: connectionId,
      event: { type: 'cancelled' },
    });

    const summary =
      result.targets.map((t) => `${t.connectionId}=${t.outcome}`).join(', ') || 'no targets';
    const message = `Cancellation relayed for order ${internalOrderId}: ${summary}`;
    // Surface any non-`applied` target (e.g. a destination that already shipped,
    // so the cancel was rejected) at warn — the cancel is never silently dropped.
    //
    // Known residual (#1160): a cancel that arrives *before* the order's
    // create/sync job has run finds no targets here, and the later create then
    // provisions the order as active. Fully closing that out-of-order race needs
    // the deferred monotonic / relay-log machinery (ADR-027 guardrails) tracked
    // with the bidirectional slices — out of scope for this unidirectional slice.
    if (result.targets.some((t) => t.outcome !== 'applied')) {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
    return [];
  }

  /**
   * Defensive read of an order record's prior business status from its snapshot
   * (#1146). Returns `undefined` when there is no prior record or the stored
   * value isn't a string — both treated as non-cancelled by the caller. Pure
   * read; binds only to the snapshot's `status` key, not its full JSON layout.
   */
  private readSnapshotStatus(existing: OrderRecord | null): string | undefined {
    const value = existing?.orderSnapshot?.status;
    return typeof value === 'string' ? value : undefined;
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
      // Carry the buyer email through (#948) — used only for customer-identity
      // resolution before this point; the snapshot needs it for the label
      // recipient. PII gating happens at persistence (`persistOrder`).
      customerEmail: incoming.customerEmail,
      items: resolvedItems,
      totals: incoming.totals,
      shippingAddress: incoming.shippingAddress,
      billingAddress: incoming.billingAddress,
      shipping: incoming.shipping,
      pickupPoint: incoming.pickupPoint,
      deliverySmart: incoming.deliverySmart,
      paymentStatus: incoming.paymentStatus,
      dispatchTime: incoming.dispatchTime,
      placedAt: incoming.placedAt ? new Date(incoming.placedAt) : undefined,
      createdAt: new Date(incoming.createdAt),
      updatedAt: new Date(incoming.updatedAt),
    };
  }
}
