/**
 * Order Record Service
 *
 * Service for persisting order records with PII-aware snapshot handling.
 * Creates order snapshots that respect OL_STORE_PII configuration, allowing
 * retry/debug without re-polling source systems.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderRecordService}
 */
import { Injectable, Inject } from '@nestjs/common';
import type { Order } from '../../domain/types/order.types';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { OrderRecord } from '../../domain/entities/order-record.entity';
import type { OrderSyncStatus, SyncAttempt } from '../../domain/types/order-sync.types';
import type { IOrderRecordService } from '../interfaces/order-record.service.interface';
import type { IncomingOrder } from '../../domain/types/incoming-order.types';
import { getPiiConfig } from '@openlinker/shared/config';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';

@Injectable()
export class OrderRecordService implements IOrderRecordService {
  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly repository: OrderRecordRepositoryPort
  ) {}

  /**
   * Persist order record with PII-aware snapshot
   *
   * Creates a snapshot of the order that respects OL_STORE_PII configuration.
   * If PII storage is disabled, sensitive fields (email, names, addresses) are
   * nulled out in the snapshot.
   *
   * @param order - Unified order with internal IDs
   * @param sourceConnectionId - Source connection ID (where order originated)
   * @param sourceEventId - Optional source event ID
   */
  async persistOrder(
    order: Order,
    sourceConnectionId: string,
    sourceEventId: string | null = null
  ): Promise<OrderRecord> {
    const piiConfig = getPiiConfig();
    const now = new Date();

    // Create PII-aware order snapshot
    const orderSnapshot: Record<string, unknown> = {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      customerId: order.customerId,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        price: item.price,
        sku: item.sku,
        // Conditional spread keeps the snapshot key absent (not `undefined`)
        // when the source did not supply the field — the snapshot is a
        // stable JSON contract surfaced to the FE, so present-only keys keep
        // the wire shape clean and let consumers tell "missing" from "blank".
        ...(item.name !== undefined && { name: item.name }),
        ...(item.imageUrl !== undefined && { imageUrl: item.imageUrl }),
      })),
      totals: order.totals,
      shippingAddress: piiConfig.storePii
        ? order.shippingAddress
        : this.sanitizeAddress(order.shippingAddress),
      billingAddress: piiConfig.storePii
        ? order.billingAddress
        : this.sanitizeAddress(order.billingAddress),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };

    // Initial sync status: pending for all destinations (will be updated as sync progresses)
    const syncStatus: OrderSyncStatus[] = [];

    const orderRecord = new OrderRecord(
      order.id,
      order.customerId || null,
      sourceConnectionId,
      sourceEventId,
      orderSnapshot,
      syncStatus,
      'ready',
      now,
      now
    );

    return this.repository.upsert(orderRecord);
  }

  async persistIncomingSnapshot(
    incoming: IncomingOrder,
    internalOrderId: string,
    customerId: string | null,
    sourceConnectionId: string,
    sourceEventId: string | null
  ): Promise<OrderRecord> {
    const piiConfig = getPiiConfig();
    const now = new Date();

    const snapshot: Record<string, unknown> = {
      externalOrderId: incoming.externalOrderId,
      orderNumber: incoming.orderNumber,
      status: incoming.status,
      customerExternalId: incoming.customerExternalId,
      // Items are passed through verbatim — this snapshot captures the raw
      // pre-mapping incoming order for debugging and retry. Optional fields
      // (name, imageUrl) propagate automatically; when an adapter omits one,
      // the property is absent and `JSON.stringify` drops it, matching the
      // present-only wire shape `persistOrder` emits below.
      items: incoming.items,
      totals: incoming.totals,
      shippingAddress: piiConfig.storePii
        ? incoming.shippingAddress
        : this.sanitizeAddress(incoming.shippingAddress),
      billingAddress: piiConfig.storePii
        ? incoming.billingAddress
        : this.sanitizeAddress(incoming.billingAddress),
      createdAt: incoming.createdAt,
      updatedAt: incoming.updatedAt,
      metadata: incoming.metadata,
    };

    const orderRecord = new OrderRecord(
      internalOrderId,
      customerId,
      sourceConnectionId,
      sourceEventId,
      snapshot,
      [],
      'awaiting_mapping',
      now,
      now
    );

    return this.repository.upsert(orderRecord);
  }

  /**
   * Update sync status for a destination
   *
   * Updates the sync status for a specific destination connection after
   * order sync completes (successfully or with error).
   *
   * @param internalOrderId - Internal order ID
   * @param destinationConnectionId - Destination connection ID
   * @param status - Sync status
   */
  async updateSyncStatus(
    internalOrderId: string,
    destinationConnectionId: string,
    status: OrderSyncStatus
  ): Promise<void> {
    // The service stamps `attemptedAt` so the repository UPDATE statement
    // is purely mechanical (no clock dependency in the persistence layer).
    const attempt: SyncAttempt = {
      destinationConnectionId,
      status: status.status,
      attemptedAt: new Date(),
      error: status.error,
      externalOrderId: status.externalOrderId,
      externalOrderNumber: status.externalOrderNumber,
    };
    await this.repository.updateSyncStatus(
      internalOrderId,
      destinationConnectionId,
      status,
      attempt
    );
  }

  /**
   * Get order record by ID
   *
   * Retrieves a persisted order record for retry/debug purposes.
   *
   * @param internalOrderId - Internal order ID
   * @returns Order record or null if not found
   */
  async getOrderRecord(internalOrderId: string): Promise<OrderRecord | null> {
    return this.repository.findById(internalOrderId);
  }

  /**
   * Sanitize address by removing PII fields
   *
   * When PII storage is disabled, removes sensitive fields from addresses
   * while keeping structural information (hash can be computed separately).
   */
  private sanitizeAddress(
    address:
      | { address1?: string; city?: string; postalCode?: string; country?: string }
      | null
      | undefined
  ): { address1: string; city: string; postalCode: string; country: string } | undefined {
    if (!address) {
      return undefined;
    }

    return {
      address1: '[REDACTED]',
      city: '[REDACTED]',
      postalCode: '[REDACTED]',
      country: address.country ?? '', // Country code is not PII
    };
  }
}
