/**
 * Marketplace Port
 *
 * Canonical capability contract for marketplace integrations.
 *
 * Domain-only: no framework dependencies.
 *
 * @module libs/core/src/integrations/domain/ports
 */

import type { IncomingOrder } from '@openlinker/core/orders/domain/types/incoming-order.types';
import {
  MarketplaceOrderFeedInput,
  MarketplaceOrderFeedOutput,
} from '../types/marketplace-order-feed.types';
import {
  MarketplaceOfferFeedInput,
  MarketplaceOfferFeedOutput,
} from '../types/marketplace-offer-feed.types';
import {
  UpdateOfferQuantityCommand,
  UpdateOfferQuantitiesBatchCommand,
  UpdateOfferQuantitiesBatchResult,
} from '../types/marketplace-quantity-update.types';
import type { UpdateOfferFieldsCommand } from '../types/marketplace-offer-update.types';
import type { MarketplaceCategory } from '../types/marketplace-category.types';
import type { CreateOfferCommand, CreateOfferResult } from '../types/marketplace-offer-create.types';
import type { SellerPolicies } from '../types/seller-policies.types';

export interface MarketplacePort {
  /**
   * List incremental order feed items (event journal).
   */
  listOrderFeed(input: MarketplaceOrderFeedInput): Promise<MarketplaceOrderFeedOutput>;

  /**
   * Fetch a full order by marketplace-native id.
   */
  getOrder(input: { externalOrderId: string }): Promise<IncomingOrder>;

  /**
   * List marketplace offers (optional).
   */
  listOffers?(input: MarketplaceOfferFeedInput): Promise<MarketplaceOfferFeedOutput>;

  /**
   * List incremental marketplace offer events (optional).
   *
   * Uses a cursor-based event journal when supported by the marketplace.
   */
  listOfferEvents?(input: MarketplaceOfferFeedInput): Promise<MarketplaceOfferFeedOutput>;

  /**
   * Update a single offer quantity.
   */
  updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void>;

  /**
   * Optional batch update API. Core orchestration will fall back to single updates.
   */
  updateOfferQuantitiesBatch?(
    cmd: UpdateOfferQuantitiesBatchCommand,
  ): Promise<UpdateOfferQuantitiesBatchResult>;

  /**
   * Update offer fields (price, title, description) — optional capability.
   *
   * Partial update semantics: only fields present in cmd.fields are sent to the marketplace.
   */
  updateOfferFields?(cmd: UpdateOfferFieldsCommand): Promise<void>;

  /**
   * Fetch marketplace categories (optional).
   */
  fetchCategories?(parentId?: string): Promise<MarketplaceCategory[]>;

  /**
   * Match a marketplace category by product barcode (EAN/GTIN) — optional capability.
   *
   * Returns the category ID if the marketplace can auto-detect a category for the
   * given barcode, or null if no match / ambiguous.
   */
  matchCategoryByBarcode?(barcode: string): Promise<string | null>;

  /**
   * Create a new offer on the marketplace — optional capability (outbound, OL → marketplace).
   *
   * Adapters that implement this translate the neutral `CreateOfferCommand` into
   * their platform-specific create-offer API call (e.g. Allegro POST /sale/product-offers).
   * Platform-specific fields (policy IDs, shipping classes, etc.) are carried in
   * `cmd.overrides.platformParams`.
   *
   * Returns momentary status (`draft` / `validating` / `active`). For marketplaces that
   * validate asynchronously (Allegro), callers must poll to observe the final outcome.
   */
  createOffer?(cmd: CreateOfferCommand): Promise<CreateOfferResult>;

  /**
   * Return the seller-configured policies the marketplace requires when
   * creating an offer (delivery, return, warranty, implied-warranty) — optional capability.
   *
   * Adapters that implement this fetch the operator's platform-native policies
   * and map them to the neutral `SellerPolicies` shape. Callers (e.g. the FE
   * offer-creation wizard) surface these in dropdowns so the operator can
   * choose which policies to attach to the new offer via
   * `CreateOfferCommand.overrides.platformParams`. Adapters that do not need
   * policy IDs for offer creation omit this method.
   */
  fetchSellerPolicies?(): Promise<SellerPolicies>;
}

