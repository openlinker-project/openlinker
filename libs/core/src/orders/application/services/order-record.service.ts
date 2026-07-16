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
import type { Order, OrderDispatchWindow } from '../../domain/types/order.types';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { OrderRecord } from '../../domain/entities/order-record.entity';
import type { OrderSyncStatus, SyncAttempt } from '../../domain/types/order-sync.types';
import type { IOrderRecordService } from '../interfaces/order-record.service.interface';
import type { IncomingOrder } from '../../domain/types/incoming-order.types';
import type {
  OrderRecordFilters,
  OrderRecordPagination,
  PaginatedOrderRecords,
} from '../../domain/types/order-record.types';
import type { FulfillmentRollupState } from '../../domain/types/order-fulfillment.types';
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
    sourceEventId: string | null = null,
    sourceExternalUrl: string | null = null
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
      // Buyer email (#948) — PII-gated + present-only. Unlike addresses (which
      // get a `[REDACTED]` placeholder via sanitizeAddress), email is omitted
      // entirely under hash-only mode: there's no meaningful redaction of an
      // atomic identifier, and the privacy model keeps only `emailHash` on the
      // customer projection. Needed for the Generate-Label recipient.
      ...(piiConfig.storePii &&
        order.customerEmail !== undefined && { customerEmail: order.customerEmail }),
      // Conditional spread matches the items-level precedent above: keep the
      // snapshot key absent (not `undefined` and not `false`) when the source
      // did not supply the flag, so consumers can distinguish "Smart not
      // reported" from "Smart explicitly false".
      ...(order.deliverySmart !== undefined && { deliverySmart: order.deliverySmart }),
      ...(order.paymentStatus !== undefined && { paymentStatus: order.paymentStatus }),
      // Marketplace-sourced COD collect amount (#1435) — present-only, like
      // paymentStatus. Read back by `OrderRecord.codToCollect` for the dispatch
      // COD gate; absent for prepaid orders and sources that don't expose it.
      ...(order.codToCollect !== undefined && { codToCollect: order.codToCollect }),
      // Dispatch (ship-by) window carried through for fidelity; the scalar
      // deadline is denormalized to the `dispatchByAt` column below (#927).
      ...(order.dispatchTime !== undefined && { dispatchTime: order.dispatchTime }),
      // Buyer-placed-on-marketplace time (#926) — absent when the source didn't
      // expose one. Conditional spread keeps the key off the snapshot rather
      // than emitting `undefined`.
      ...(order.placedAt !== undefined && { placedAt: order.placedAt.toISOString() }),
      // Source-side delivery method + pickup point (#952) — present-only, like
      // deliverySmart/dispatchTime. NOT PII-gated: a carrier method id/name and a
      // public locker code aren't personal data (the locker's address is folded
      // into the PII-gated shippingAddress). Needed by the order-detail Delivery
      // panel, the Generate-Label paczkomat pre-fill, and — critically —
      // fulfillment routing, which keys on `shipping.methodId` (absent it, routing
      // always resolves to the omp_fulfilled default).
      ...(order.shipping !== undefined && { shipping: order.shipping }),
      ...(order.pickupPoint !== undefined && { pickupPoint: order.pickupPoint }),
      // Source-platform deep link (#1713) — present-only. Built by the source
      // adapter (it owns the URL scheme + base URL); the FE renders the
      // "Open order" link off this key. Absent when the source can't build one.
      ...(sourceExternalUrl !== null && { sourceExternalUrl }),
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
      now,
      [],
      this.deriveDispatchByAt(order.dispatchTime)
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
      // Buyer email (#948) — PII-gated + present-only; see persistOrder for the
      // omit-vs-redact rationale. For "ready" orders this awaiting_mapping
      // snapshot is overwritten by persistOrder, so this write is for
      // consistency/debugging of records still awaiting item mapping (which
      // can't generate a label yet anyway) — persistOrder is the load-bearing
      // write for the label flow.
      ...(piiConfig.storePii &&
        incoming.customerEmail !== undefined && { customerEmail: incoming.customerEmail }),
      createdAt: incoming.createdAt,
      updatedAt: incoming.updatedAt,
      metadata: incoming.metadata,
      // See `persistOrder` above for the absent-vs-false rationale.
      ...(incoming.deliverySmart !== undefined && { deliverySmart: incoming.deliverySmart }),
      ...(incoming.paymentStatus !== undefined && { paymentStatus: incoming.paymentStatus }),
      // Marketplace-sourced COD collect amount (#1435) — see persistOrder.
      ...(incoming.codToCollect !== undefined && { codToCollect: incoming.codToCollect }),
      ...(incoming.dispatchTime !== undefined && { dispatchTime: incoming.dispatchTime }),
      // Buyer-placed-on-marketplace time (#926) — ISO string passed through verbatim.
      ...(incoming.placedAt !== undefined && { placedAt: incoming.placedAt }),
      // Source-side delivery method + pickup point (#952) — see persistOrder for
      // the present-only + non-PII rationale. Same fields, same placement.
      ...(incoming.shipping !== undefined && { shipping: incoming.shipping }),
      ...(incoming.pickupPoint !== undefined && { pickupPoint: incoming.pickupPoint }),
      // Source-platform deep link (#1713) — see persistOrder. Written here too so
      // records still awaiting item mapping carry the link before the ready-path
      // snapshot overwrites this one.
      ...(incoming.externalUrl !== undefined && { sourceExternalUrl: incoming.externalUrl }),
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
      now,
      [],
      this.deriveDispatchByAt(incoming.dispatchTime)
    );

    return this.repository.upsert(orderRecord);
  }

  /**
   * Derive the scalar ship-by deadline (`dispatchByAt`) from a dispatch window
   * (#927) — the `.to` bound. Returns `null` when absent or unparseable, so the
   * column and SLA surfaces degrade gracefully. Re-run on every persist (both
   * the `awaiting_mapping` and `ready` paths) so a re-pulled order with a
   * changed window updates the column.
   */
  private deriveDispatchByAt(window: OrderDispatchWindow | undefined): Date | null {
    const to = window?.to;
    if (!to) {
      return null;
    }
    const parsed = new Date(to);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
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

  async findMany(
    filters: OrderRecordFilters,
    pagination: OrderRecordPagination
  ): Promise<PaginatedOrderRecords> {
    return this.repository.findMany(filters, pagination);
  }

  async updateFulfillmentState(
    internalOrderId: string,
    fulfillmentState: FulfillmentRollupState
  ): Promise<void> {
    await this.repository.updateFulfillmentState(internalOrderId, fulfillmentState);
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
