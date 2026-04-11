/**
 * Marketplace Job Payload Types (Generic)
 *
 * Canonical payload schemas for marketplace.* sync jobs.
 *
 * @module libs/core/src/sync/domain/types
 */

import { MarketplaceOrderEventType } from '@openlinker/core/integrations';

export interface MarketplaceOrdersPollPayloadV1 {
  schemaVersion: 1;
  cursorKey: string;
  limit: number;
  eventTypes?: MarketplaceOrderEventType[];
}

export interface MarketplaceOrderSyncPayloadV1 {
  schemaVersion: 1;
  externalOrderId: string;
  /**
   * Source event identifier for traceability/idempotency (typically feedItem.eventKey).
   */
  sourceEventId?: string;
  /**
   * Optional metadata from the feed item (useful for debugging/observability).
   */
  eventKey?: string;
  occurredAt?: string;
  eventType?: MarketplaceOrderEventType;
}

export interface MarketplaceOfferQuantityUpdatePayloadV1 {
  schemaVersion: 1;
  offerId: string;
  quantity: number;
  idempotencyKey?: string;
}

export interface MarketplaceOfferFieldUpdatePayloadV1 {
  schemaVersion: 1;
  /** Internal OpenLinker offer ID (resolved to external ID by the handler). */
  offerId: string;
  fields: import('@openlinker/core/listings').OfferFieldUpdate;
  idempotencyKey?: string;
}

export interface MarketplaceOffersSyncPayloadV1 {
  schemaVersion: 1;
  limit: number;
  cursor?: string | null;
  cursorKey?: string;
  feedType?: 'offers' | 'events';
  masterConnectionId?: string | null;
}