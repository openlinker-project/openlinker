/**
 * Marketplace Job Payload Types (Generic)
 *
 * Canonical payload schemas for marketplace.* sync jobs.
 *
 * @module libs/core/src/sync/domain/types
 */

import {
  CreateOfferOverrides,
  MarketplaceOrderEventType,
} from '@openlinker/core/integrations';

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

/**
 * Payload for `marketplace.offer.create` jobs.
 *
 * Connection id is taken from `job.connectionId`, not from the payload.
 *
 * `schemaVersion: 1` pins the contract. Future breaking changes bump
 * `schemaVersion`; handlers must accept all versions they have seen in
 * persisted jobs until the backlog is drained.
 */
export interface MarketplaceOfferCreatePayloadV1 {
  schemaVersion: 1;
  /** OL internal variant id being listed. */
  internalVariantId: string;
  /** Offered stock quantity. */
  stock: number;
  /** Publish immediately after creation. */
  publishImmediately: boolean;
  /** Optional explicit price; when omitted the builder falls back to master product. */
  price?: { amount: number; currency: string };
  /** Optional overrides (title, description, category, images, platformParams). */
  overrides?: CreateOfferOverrides;
  /** Optional idempotency key forwarded to the adapter. */
  idempotencyKey?: string;
  /**
   * Pre-created OfferCreationRecord id, if the caller (e.g. #259 REST endpoint)
   * wanted the record visible before the job ran. When omitted, the execution
   * service creates a fresh record with status='pending'.
   */
  offerCreationRecordId?: string;
}