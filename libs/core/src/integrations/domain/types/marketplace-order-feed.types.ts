/**
 * Marketplace Order Feed Types
 *
 * Canonical order-feed (event journal) types for the Marketplace capability.
 *
 * Domain-only: no framework dependencies.
 *
 * @module libs/core/src/integrations/domain/types
 */

import { MarketplaceCursor } from './marketplace-cursor.types';

/**
 * Marketplace order event type values.
 *
 * NOTE: Keep this small for MVP and extend as we add more marketplaces.
 */
export const MarketplaceOrderEventTypeValues = [
  'created',
  'updated',
  'cancelled',
  'paid',
] as const;

export type MarketplaceOrderEventType =
  (typeof MarketplaceOrderEventTypeValues)[number];

/**
 * Input for listing incremental order feed items from a marketplace.
 */
export interface MarketplaceOrderFeedInput {
  /**
   * Cursor to resume from. Null means "start from the beginning" (adapter-defined).
   */
  fromCursor: MarketplaceCursor | null;

  /**
   * Max items to return.
   */
  limit: number;

  /**
   * Optional event type filter.
   */
  eventTypes?: MarketplaceOrderEventType[];
}

/**
 * A minimal order feed item suitable for downstream job scheduling.
 */
export interface MarketplaceOrderFeedItem {
  /**
   * Marketplace-native order identifier (generic; not `checkoutFormId`, etc.).
   */
  externalOrderId: string;

  /**
   * High-level event type (created/updated/cancelled/paid...).
   */
  eventType: MarketplaceOrderEventType;

  /**
   * ISO timestamp when the event occurred at the marketplace.
   */
  occurredAt: string;

  /**
   * Deterministic, stable key used for dedupe / job idempotency.
   *
   * Adapters should prefer a marketplace-provided stable event ID / sequence
   * if available. Otherwise, use a safe composite (e.g., externalOrderId + occurredAt + eventType).
   */
  eventKey: string;

  /**
   * Optional raw marketplace event identifier if provided.
   */
  eventId?: string;

  /**
   * Optional raw payload for debug/audit. Never required by core.
   */
  raw?: unknown;
}

/**
 * Output of a cursor-based marketplace order feed listing.
 *
 * Cursor invariants:
 * - `nextCursor` must be monotonic per connection.
 * - `nextCursor = null` means "no cursor advancement possible" (adapter-defined).
 */
export interface MarketplaceOrderFeedOutput {
  items: MarketplaceOrderFeedItem[];
  nextCursor: MarketplaceCursor | null;
}

