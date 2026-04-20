/**
 * Marketplace Offer Create Types
 *
 * Command and result types for creating a new offer on a marketplace (outbound,
 * OpenLinker → marketplace). Command is marketplace-neutral; adapter-specific
 * fields (Allegro delivery policy IDs, eBay shipping options, WooCommerce tax
 * classes, etc.) are carried through `overrides.platformParams` as an opaque
 * record the adapter interprets.
 *
 * @module libs/core/src/integrations/domain/types
 */

/**
 * Overrides for fields that can optionally be customized per-offer.
 * Any field omitted here falls back to a value derived by the core builder
 * service from the OL variant (e.g. variant.name, variant.description).
 */
export interface CreateOfferOverrides {
  /** Offer title. Falls back to variant name. */
  title?: string;
  /** Offer description (HTML or rich text depending on platform). Falls back to variant description. */
  description?: string;
  /** Platform-specific category id (e.g. Allegro category id). */
  categoryId?: string;
  /** Image URLs in display order. Falls back to variant images. */
  imageUrls?: string[];
  /**
   * Platform-specific parameters the adapter interprets directly.
   *
   * Examples by platform:
   * - Allegro: `{ deliveryPolicyId, returnPolicyId, warrantyId, impliedWarrantyId }`
   * - eBay: shipping service options, listing duration
   * - WooCommerce: tax class, shipping class, product type
   *
   * The core command stays platform-neutral; adapters read only the keys they know.
   */
  platformParams?: Record<string, unknown>;
}

/**
 * Command to create a new marketplace offer.
 *
 * Marketplace-neutral contract. Allegro, eBay, WooCommerce, Shopify adapters
 * translate this into their platform-specific create-offer API call internally.
 */
export interface CreateOfferCommand {
  /** OL internal variant id being listed. */
  internalVariantId: string;
  /** Target marketplace connection id. */
  connectionId: string;
  /** Offer price. Currency should match marketplace/connection locale. */
  price: { amount: number; currency: string };
  /** Offered quantity. */
  stock: number;
  /** If true, publish the offer immediately after creation; otherwise leave as draft. */
  publishImmediately: boolean;
  /** Optional overrides and platform-specific fields. */
  overrides?: CreateOfferOverrides;
  /** Optional idempotency key for deduplication at the adapter / job layer. */
  idempotencyKey?: string;
}

/**
 * Momentary status returned by the adapter right after the platform API call.
 *
 * - `draft`: Offer created on platform, not yet published.
 * - `validating`: Platform is asynchronously validating the offer (Allegro pattern).
 *   Caller must poll / listen for final outcome before treating the offer as live.
 * - `active`: Offer is live and visible to buyers.
 *
 * Not to be confused with the persisted `OfferCreationStatus` lifecycle — see
 * `offer-creation-record.types.ts`.
 */
export const CreateOfferResultStatusValues = ['draft', 'validating', 'active'] as const;
export type CreateOfferResultStatus = (typeof CreateOfferResultStatusValues)[number];

/**
 * Result returned by `MarketplacePort.createOffer`.
 */
export interface CreateOfferResult {
  /** Marketplace-native id of the newly created offer. */
  externalOfferId: string;
  /** Adapter-reported status immediately after the create call. */
  status: CreateOfferResultStatus;
}
