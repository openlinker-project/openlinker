/**
 * Order Ingestion Service Interface
 *
 * Defines the contract for marketplace order ingestion (cursor-based) and
 * order hydration + routing.
 *
 * @module libs/core/src/orders/application/interfaces
 */

import type { OrderFeedEventType } from '@openlinker/core/orders';
import type { MarketplaceOrdersImportPayloadV1 } from '@openlinker/core/sync';
import type { OrderSyncRequest, OrderSyncResult } from './order-sync.service.interface';

export interface OrderIngestionOptions {
  cursorKey: string;
  limit: number;
  eventTypes?: OrderFeedEventType[];
}

export interface OrderIngestionResult {
  fetched: number;
  enqueued: number;
  nextCursor: string | null;
  committed: boolean;
  skippedDueToLock: boolean;
}

export interface OrderImportPageResult {
  fetched: number;
  enqueued: number;
  /** True when this page was the last one of the run. */
  done: boolean;
  /** Another import page held the connection's import lock; the caller should retry. */
  skippedDueToLock: boolean;
}

export interface IOrderIngestionService {
  /**
   * Read ONE page of an order import over a date window (newest-first history,
   * or a range the operator asked for), enqueue the orders it holds, and - when
   * the source says there is more - enqueue the next page. Never reads or moves
   * the live feed cursor (#4228).
   *
   * @throws OrderSyncStartUnavailableError when the source cannot read a window.
   */
  importOrderWindow(
    connectionId: string,
    payload: MarketplaceOrdersImportPayloadV1
  ): Promise<OrderImportPageResult>;

  /**
   * Poll marketplace feed, enqueue downstream sync jobs, and commit cursor safely.
   */
  ingestOrders(connectionId: string, options: OrderIngestionOptions): Promise<OrderIngestionResult>;

  /**
   * Hydrate a marketplace order and route it to destination processor(s).
   *
   * `eventType === 'cancelled'` routes through the lifecycle relay (propagate the
   * cancel to destinations) instead of the create/update path (#1158 / #1132).
   */
  syncOrderFromSource(
    connectionId: string,
    externalOrderId: string,
    sourceEventId?: string,
    eventType?: OrderFeedEventType,
    deferralBudget?: OrderSyncRequest['deferralBudget']
  ): Promise<OrderSyncResult[]>;
}
