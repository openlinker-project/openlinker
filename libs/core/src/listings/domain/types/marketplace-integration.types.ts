/**
 * Marketplace Integration Types
 *
 * Shared types for the Marketplace capability. Defines cursor-based order feed
 * structures and offer quantity update result types used by Marketplace adapters.
 *
 * This file contains types only (per engineering standards).
 *
 * @module libs/core/src/listings/domain/types
 */

/**
 * Marketplace order feed item
 *
 * Represents a single order reference from a marketplace feed.
 * The adapter can later hydrate this into a full unified Order.
 */
export interface MarketplaceOrderFeedItem {
  /**
   * Stable event identifier used for idempotency (e.g., Allegro order event id).
   */
  eventId: string;

  /**
   * Marketplace-native order identifier used to fetch full order details
   * (e.g., Allegro checkoutFormId).
   */
  checkoutFormId: string;
}

/**
 * Marketplace order feed response
 *
 * Cursor-based listing of order references.
 */
export interface MarketplaceOrderFeedResponse {
  items: MarketplaceOrderFeedItem[];
  nextCursor: string;
}

/**
 * Offer quantity update status values
 */
export const OfferQuantityUpdateStatusValues = ['queued', 'accepted', 'rejected'] as const;

/**
 * Offer quantity update status
 */
export type OfferQuantityUpdateStatus = (typeof OfferQuantityUpdateStatusValues)[number];

/**
 * Request to update an offer quantity on a marketplace.
 */
export interface UpdateOfferQuantityRequest {
  offerId: string;
  quantity: number;

  /**
   * Idempotency key provided by the caller to deduplicate repeated requests
   * across retries and at-least-once job execution.
   */
  idempotencyKey: string;
}

/**
 * Result of submitting an offer quantity update.
 *
 * Marketplaces may implement this as an asynchronous command behind the scenes.
 */
export interface UpdateOfferQuantityResult {
  commandId: string;
  status: OfferQuantityUpdateStatus;
}




