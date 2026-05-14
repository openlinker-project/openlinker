/**
 * Order Feed Types
 *
 * Canonical order-feed (event journal) types for the OrderSource capability.
 * Platform-neutral: consumed by both marketplace adapters (Allegro event IDs)
 * and shop adapters (PrestaShop `date_upd` watermarks) via `OrderSourcePort`.
 *
 * Domain-only: no framework dependencies.
 *
 * @module libs/core/src/orders/domain/types
 */

import type { MarketplaceCursor } from '@openlinker/core/integrations';

/**
 * Order-feed event type values.
 *
 * NOTE: Keep this small for MVP and extend as we add more sources.
 */
export const OrderFeedEventTypeValues = ['created', 'updated', 'cancelled', 'paid'] as const;

export type OrderFeedEventType = (typeof OrderFeedEventTypeValues)[number];

/**
 * Input for listing incremental order feed items from an order source.
 */
export interface OrderFeedInput {
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
  eventTypes?: OrderFeedEventType[];
}

/**
 * A minimal order feed item suitable for downstream job scheduling.
 */
export interface OrderFeedItem {
  /**
   * Source-native order identifier (generic; not `checkoutFormId`, etc.).
   */
  externalOrderId: string;

  /**
   * High-level event type (created/updated/cancelled/paid...).
   */
  eventType: OrderFeedEventType;

  /**
   * ISO timestamp when the event occurred at the source.
   */
  occurredAt: string;

  /**
   * Deterministic, stable key used for dedupe / job idempotency.
   *
   * Adapters should prefer a source-provided stable event ID / sequence
   * if available. Otherwise, use a safe composite (e.g., externalOrderId + occurredAt + eventType).
   */
  eventKey: string;

  /**
   * Optional raw source event identifier if provided.
   */
  eventId?: string;

  /**
   * Optional raw payload for debug/audit. Never required by core.
   */
  raw?: unknown;
}

/**
 * Output of a cursor-based order feed listing.
 *
 * Cursor invariants:
 * - `nextCursor` must be monotonic per connection.
 * - `nextCursor = null` means "no cursor advancement possible" (adapter-defined).
 */
export interface OrderFeedOutput {
  items: OrderFeedItem[];
  nextCursor: MarketplaceCursor | null;
}
