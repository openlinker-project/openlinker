/**
 * Order Ingestion Service Interface
 *
 * Defines the contract for marketplace order ingestion (cursor-based) and
 * order hydration + routing.
 *
 * @module libs/core/src/orders/application/interfaces
 */

import type { OrderFeedEventType } from '@openlinker/core/orders';
import type { OrderSyncResult } from './order-sync.service.interface';

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

export interface IOrderIngestionService {
  /**
   * Poll marketplace feed, enqueue downstream sync jobs, and commit cursor safely.
   */
  ingestOrders(connectionId: string, options: OrderIngestionOptions): Promise<OrderIngestionResult>;

  /**
   * Hydrate a marketplace order and route it to destination processor(s).
   */
  syncOrderFromSource(
    connectionId: string,
    externalOrderId: string,
    sourceEventId?: string
  ): Promise<OrderSyncResult[]>;
}
