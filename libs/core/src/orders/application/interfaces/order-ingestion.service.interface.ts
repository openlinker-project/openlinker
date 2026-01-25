/**
 * Order Ingestion Service Interface
 *
 * Defines the contract for marketplace order ingestion (cursor-based) and
 * order hydration + routing.
 *
 * @module libs/core/src/orders/application/interfaces
 */

import { MarketplaceOrderEventType } from '@openlinker/core/integrations';
import { OrderSyncResult } from './order-sync.service.interface';

export interface MarketplaceIngestionOptions {
  cursorKey: string;
  limit: number;
  eventTypes?: MarketplaceOrderEventType[];
}

export interface MarketplaceIngestionResult {
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
  syncFromMarketplace(
    connectionId: string,
    options: MarketplaceIngestionOptions,
  ): Promise<MarketplaceIngestionResult>;

  /**
   * Hydrate a marketplace order and route it to destination processor(s).
   */
  syncOrderFromMarketplace(
    connectionId: string,
    externalOrderId: string,
    sourceEventId?: string,
  ): Promise<OrderSyncResult[]>;
}

