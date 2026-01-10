/**
 * Allegro API Types
 *
 * Type definitions for Allegro Public API request/response structures.
 * These types represent the external API contract and are used by adapters
 * to communicate with Allegro's Public API.
 *
 * @module libs/integrations/allegro/src/domain/types
 */

// eslint-disable-next-line no-restricted-imports
import { AllegroOrderEvent } from '../../infrastructure/mappers/allegro-order.mapper';

/**
 * Allegro order events API response
 *
 * Response from GET /order/events endpoint containing order event references.
 */
export interface AllegroOrderEventsResponse {
  events: AllegroOrderEvent[];
  lastEventId?: string;
}

/**
 * Allegro offer quantity change command request
 *
 * Request body for PUT /sale/offer-quantity-change-commands/{commandId} endpoint.
 */
export interface AllegroOfferQuantityChangeCommand {
  offerId: string;
  quantityChange: {
    changeType: 'FIXED';
    value: number;
  };
}

/**
 * Allegro offer quantity change command response
 *
 * Response from PUT /sale/offer-quantity-change-commands/{commandId} endpoint.
 */
export interface AllegroOfferQuantityChangeCommandResponse {
  id: string;
  status: 'QUEUED' | 'ACCEPTED' | 'REJECTED';
  errors?: Array<{
    code: string;
    message: string;
  }>;
}



