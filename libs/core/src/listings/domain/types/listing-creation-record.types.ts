/**
 * Listing Creation Record Types
 *
 * Types for `ListingCreationRecord` — OL's persisted lifecycle tracker for a
 * product published outbound onto a **shop** destination (OL → WooCommerce /
 * Shopify / …) via `ShopProductManagerPort.publishProduct` (#1042, ADR-024).
 * The shop-side sibling of `offer-creation-record.types.ts`; a separate table
 * keeps the hot marketplace offer path untouched.
 *
 * The shop lifecycle has no async-validation hop — a publish lands directly at
 * `draft` or `published` (or `failed`), so the status set is narrower than the
 * marketplace `OfferCreationStatus` (which carries `validating` / `active`).
 *
 * @module libs/core/src/listings/domain/types
 */

import type { OfferCreationError } from './offer-creation-record.types';

/**
 * Neutral structured error persisted in `ListingCreationRecord.errors`. Reuses
 * the marketplace `OfferCreationError` shape (`{ field?, code, message }`) — it
 * is platform-neutral — re-exported under a listing-neutral name so the shop
 * path doesn't import an offer-named symbol at call sites.
 */
export type ListingCreationError = OfferCreationError;

/**
 * Persisted lifecycle status for an OL-initiated shop product publish.
 *
 * - `pending`: Job enqueued, shop adapter not yet called.
 * - `draft`: Adapter created/updated the product record, not buyer-visible.
 * - `published`: Product record live and visible on the storefront.
 * - `failed`: Publish was rejected terminally. See `errors` on the record.
 */
export const ListingCreationStatusValues = ['pending', 'draft', 'published', 'failed'] as const;

export type ListingCreationStatus = (typeof ListingCreationStatusValues)[number];

/**
 * Named-constant map for the listing-creation lifecycle status (mirrors
 * `OFFER_CREATION_STATUS`, #668). `as const satisfies Record<Capitalize<…>, …>`
 * keeps the map in lockstep with the union on both axes.
 */
export const LISTING_CREATION_STATUS = {
  Pending: 'pending',
  Draft: 'draft',
  Published: 'published',
  Failed: 'failed',
} as const satisfies Record<Capitalize<ListingCreationStatus>, ListingCreationStatus>;

/**
 * Input contract for `ListingCreationRecordRepositoryPort.create`. Dedicated
 * input type (not `Omit<ListingCreationRecord, …>`) so the write contract is
 * decoupled from the entity's readonly shape.
 */
export interface CreateListingCreationRecordInput {
  /** OL internal variant id being published. */
  internalVariantId: string;
  /** Target shop connection id. */
  connectionId: string;
  /** Initial lifecycle status — typically `'pending'`. */
  status: ListingCreationStatus;
  /** Shop-native product id, if already known at creation time. Null otherwise. */
  externalProductId?: string | null;
  /** Structured errors when the initial status is already `'failed'`. Null otherwise. */
  errors?: ListingCreationError[] | null;
}
