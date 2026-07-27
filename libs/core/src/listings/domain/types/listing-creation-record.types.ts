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
import type { OfferParameter } from './offer-parameter.types';
import type {
  PublishProductCommerce,
  PublishProductContent,
  PublishProductStatus,
} from './product-publish.types';

/**
 * Persisted snapshot of the original per-item publish request (#1845). Captures
 * the neutral fields needed to rebuild a `shop.product.publish` payload on retry
 * without re-deriving them - the shop-side sibling of
 * `OfferCreationRequestSnapshot`. Stored on the `ListingCreationRecord` at
 * enqueue time; the retry service reads it to re-run only the failed children.
 * Batch-scoped AI/shared flags are NOT carried here (they live on the batch's
 * `sharedConfig`, mirroring the offer path).
 */
export interface ShopPublishRequestSnapshot {
  /** OL internal variant id being published. */
  internalVariantId: string;
  /** Target publication state (draft vs published). */
  status: PublishProductStatus;
  /** Stock quantity as a product/variant field on the shop. */
  stock: number;
  /** Explicit price; omitted when the builder should fall back to master. */
  price?: { amount: number; currency: string };
  /** Destination category ids resolved upstream. Omitted when deferred/manual. */
  destinationCategoryIds?: string[];
  /** Owned-record content overrides (title, description, images, SEO). */
  content?: PublishProductContent;
  /** Operator-supplied commerce fields (sale price, dimensions, tax). */
  commerce?: PublishProductCommerce;
  /** Neutral projected category parameters (same channel the offer path uses). */
  parameters?: OfferParameter[];
}

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
  /** Parent bulk-batch id when created as part of a bulk submission (#1044). Null/omitted for single publishes. */
  bulkBatchId?: string | null;
  /** Non-fatal warnings emitted by the adapter on a successful publish (#1131). Null/omitted when none. */
  warnings?: string[] | null;
  /** Persisted per-item publish request snapshot for retry (#1845). Null/omitted when not captured. */
  request?: ShopPublishRequestSnapshot | null;
}
