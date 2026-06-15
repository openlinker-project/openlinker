/**
 * Shop Job Payload Types (Generic)
 *
 * Canonical payload schemas for shop.* sync jobs — the shop-listing
 * counterpart to `marketplace-job-payloads.types.ts`. Today: the
 * `shop.product.publish` job (ADR-024) that publishes a master catalog product
 * onto a shop destination (WooCommerce, Shopify, …). The job is executed by the
 * #1042 worker handler; this file defines the wire shape only.
 *
 * @module libs/core/src/sync/domain/types
 */

import type {
  PublishProductStatus,
  PublishProductContent,
} from '@openlinker/core/listings';

/**
 * Payload for `shop.product.publish` jobs (ADR-024).
 *
 * Lean wire shape carrying what the #1042 execution service needs to rebuild a
 * `PublishProductCommand`. Connection id is taken from `job.connectionId`, not
 * the payload (mirrors `MarketplaceOfferCreatePayloadV1`).
 *
 * `schemaVersion: 1` pins the contract. Future breaking changes bump
 * `schemaVersion`; handlers must accept all versions they have seen in
 * persisted jobs until the backlog is drained.
 */
export interface ShopProductPublishPayloadV1 {
  schemaVersion: 1;
  /** OL internal variant id being published. */
  internalVariantId: string;
  /** Target publication state (draft vs published). */
  status: PublishProductStatus;
  /** Stock quantity, as a product/variant field on the shop. */
  stock: number;
  /** Optional explicit price; when omitted the builder falls back to master product. */
  price?: { amount: number; currency: string };
  /**
   * Destination category ids resolved/provisioned upstream by the ADR-023
   * placement chain. Omitted when category placement is deferred / manual.
   */
  destinationCategoryIds?: string[];
  /** Optional owned-record content overrides (title, description, images, SEO). */
  content?: PublishProductContent;
  /** Optional idempotency key forwarded to the adapter. */
  idempotencyKey?: string;
  /**
   * Pre-created listing-record id, if the caller wanted the record visible
   * before the job ran. When omitted, the #1042 execution service creates a
   * fresh record. (The generalised listing-creation record lands in #1042.)
   */
  listingCreationRecordId?: string;
}
