/**
 * Allegro API Types
 *
 * Type definitions for Allegro Public API request/response structures.
 * These types represent the external API contract and are used by adapters
 * to communicate with Allegro's Public API.
 *
 * @module libs/integrations/allegro/src/domain/types
 */

/**
 * Allegro checkout form (from GET /order/checkout-forms/{id})
 */
export interface AllegroCheckoutForm {
  id: string;
  messageToSeller?: string;
  buyer: {
    id: string;
    email?: string;
    login?: string;
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
    address?: {
      street?: string;
      city?: string;
      zipCode?: string;
      countryCode?: string;
    };
  };
  payment: {
    type: string;
    provider?: string;
    finishedAt?: string;
    paidAmount?: {
      amount: string;
      currency: string;
    };
  };
  lineItems: Array<{
    id: string;
    offer: {
      id: string;
      name: string;
    };
    quantity: number;
    price: {
      amount: string;
      currency: string;
    };
    boughtAt?: string;
  }>;
  summary: {
    totalToPay: {
      amount: string;
      currency: string;
    };
  };
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Allegro order event (from GET /order/events)
 */
export interface AllegroOrderEvent {
  id: string;
  order: {
    id: string;
    checkoutForm: {
      id: string;
    };
  };
  occurredAt: string;
  type: string;
}

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
 * Allegro offer event (from GET /sale/offer-events)
 */
export interface AllegroOfferEvent {
  id: string;
  occurredAt: string;
  type: string;
  offer: {
    id: string;
    external?: {
      id?: string | null;
    };
  };
}

/**
 * Allegro offer events API response
 *
 * Response from GET /sale/offer-events endpoint containing offer event references.
 */
export interface AllegroOfferEventsResponse {
  offerEvents: AllegroOfferEvent[];
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

/**
 * Allegro offers list item (from GET /sale/offers)
 */
export interface AllegroOfferListItem {
  id: string;
  category?: {
    id: string;
  };
  external?: {
    id?: string | null;
  };
}

/**
 * Allegro offers list response
 */
export interface AllegroOffersResponse {
  offers: AllegroOfferListItem[];
  count: number;
  totalCount: number;
}

/**
 * Allegro offer parameter entry (from GET /sale/product-offers/{offerId})
 */
export interface AllegroOfferParameter {
  id: string;
  name?: string;
  values?: string[];
  valuesIds?: string[];
}

/**
 * Allegro product offer (from GET /sale/product-offers/{offerId})
 */
export interface AllegroProductOffer {
  id: string;
  name?: string;
  category?: {
    id: string;
  };
  parameters?: AllegroOfferParameter[];
  productSet?: Array<{
    product?: {
      parameters?: AllegroOfferParameter[];
    };
  }>;
  external?: {
    id?: string | null;
  };
}

/**
 * Allegro category parameters response (from GET /sale/categories/{categoryId}/parameters)
 */
export interface AllegroCategoryParametersResponse {
  parameters: Array<{
    id: string;
    name: string;
  }>;
}



