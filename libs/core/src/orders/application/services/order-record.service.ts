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
import { Order } from '../../domain/ports/order-source.port';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { OrderRecord, OrderSyncStatus } from '../../domain/entities/order-record.entity';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import { getPiiConfig } from '@openlinker/shared/config';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';

@Injectable()
export class OrderRecordService implements IOrderRecordService {
  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly repository: OrderRecordRepositoryPort,
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
    sourceEventId: string | null = null,
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
      now,
      now,
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
    status: OrderSyncStatus,
  ): Promise<void> {
    await this.repository.updateSyncStatus(internalOrderId, destinationConnectionId, status);
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
    address: Order['shippingAddress'],
  ): { address1: string; city: string; postalCode: string; country: string } | undefined {
    if (!address) {
      return undefined;
    }

    return {
      address1: '[REDACTED]',
      city: '[REDACTED]',
      postalCode: '[REDACTED]',
      country: address.country, // Country code is not PII
    };
  }
}
