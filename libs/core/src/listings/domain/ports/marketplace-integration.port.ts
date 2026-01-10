/**
 * Marketplace Integration Port
 *
 * Defines the contract for marketplace integrations used by the Listings bounded context.
 * Implementations live in integration packages (e.g., Allegro) and are resolved per-connection.
 *
 * Responsibilities of adapters implementing this port:
 * - Fetch order references from a marketplace feed (cursor-based, incremental)
 * - Fetch full order details and map them to the unified Order schema with internal IDs
 * - Update marketplace offer quantities (hiding marketplace-specific command patterns)
 *
 * @module libs/core/src/listings/domain/ports
 */

import { Order } from '@openlinker/core/orders';
import {
  MarketplaceOrderFeedResponse,
  UpdateOfferQuantityRequest,
  UpdateOfferQuantityResult,
} from '../types/marketplace-integration.types';

export interface MarketplaceIntegrationPort {
  /**
   * Get incremental marketplace orders.
   *
   * Cursor semantics are adapter-specific; callers treat cursor as an opaque value.
   */
  getOrders(params: { cursor?: string; limit?: number }): Promise<MarketplaceOrderFeedResponse>;

  /**
   * Get a full order by marketplace-native checkout form id.
   *
   * The adapter must return a unified Order with internal OpenLinker IDs.
   */
  getOrderByCheckoutFormId(checkoutFormId: string): Promise<Order>;

  /**
   * Update the marketplace offer quantity.
   *
   * Adapters may implement this as an asynchronous command internally; callers
   * should treat the returned commandId as an opaque identifier for observability.
   */
  updateOfferQuantity(request: UpdateOfferQuantityRequest): Promise<UpdateOfferQuantityResult>;
}




