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
   * Update a single offer quantity.
   */
  updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void>;

  /**
   * Optional batch update API. Core orchestration will fall back to single updates.
   */
  updateOfferQuantitiesBatch?(
    cmd: UpdateOfferQuantitiesBatchCommand,
  ): Promise<UpdateOfferQuantitiesBatchResult>;
}

