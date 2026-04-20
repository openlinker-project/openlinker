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
 * Allegro offer quantity change command status response
 *
 * Response from GET /sale/offer-quantity-change-commands/{commandId} endpoint.
 * Used to poll for async command completion status.
 */
export type AllegroCommandTaskStatus = 'NEW' | 'IN_PROGRESS' | 'SUCCESS' | 'FAIL';

export interface AllegroQuantityChangeCommandStatusResponse {
  id: string;
  taskCount: number;
  completedTaskCount?: number;
  tasks: Array<{
    offerId: string;
    status: AllegroCommandTaskStatus;
    message?: string;
    errors?: Array<{
      code: string;
      message: string;
    }>;
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
 * Allegro category item (from GET /sale/categories)
 */
export interface AllegroCategoryItem {
  id: string;
  name: string;
  parent?: {
    id: string;
  } | null;
  leaf: boolean;
}

/**
 * Allegro categories response (from GET /sale/categories)
 */
export interface AllegroCategoriesResponse {
  categories: AllegroCategoryItem[];
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

/**
 * Allegro offer fields PATCH request body (PATCH /sale/product-offers/{offerId})
 *
 * All fields are optional — only fields present in the object are sent to Allegro.
 */
export interface AllegroOfferFieldsPatchBody extends Record<string, unknown> {
  name?: string;
  sellingMode?: {
    price?: {
      amount: string;
      currency: string;
    };
  };
  description?: {
    sections: Array<{
      items: Array<{
        type: 'TEXT';
        content: string;
      }>;
    }>;
  };
}

/**
 * Response from Allegro GET /sale/matching-categories
 *
 * Returns categories that match a given product identified by barcode (EAN/GTIN).
 */
export interface AllegroMatchingCategoriesResponse {
  matchingCategories: Array<{
    category: {
      id: string;
      name?: string;
    };
  }>;
}

/**
 * Allegro offer publication status — Allegro's string enum from the
 * `publication.status` field on the product-offer resource.
 *
 * `INACTIVE` — draft, not visible to buyers.
 * `ACTIVE` — published and visible.
 * `ACTIVATING` / `INACTIVATING` — transient async state during publication changes.
 * `ENDED` — publication has ended (historical).
 */
export const AllegroOfferPublicationStatusValues = [
  'INACTIVE',
  'ACTIVE',
  'ACTIVATING',
  'INACTIVATING',
  'ENDED',
] as const;
export type AllegroOfferPublicationStatus = (typeof AllegroOfferPublicationStatusValues)[number];

/**
 * Validation error returned by Allegro when creating or updating an offer.
 * Can appear on 2xx responses (offer created but has issues blocking publication)
 * as well as on 422 responses (offer not created).
 */
export interface AllegroValidationError {
  code: string;
  message: string;
  details?: string;
  path?: string;
  userMessage?: string;
}

/**
 * Minimal body accepted by `POST /sale/product-offers`.
 *
 * Many fields are optional for the API itself but may be required by the
 * target category's validation — Allegro surfaces those as 2xx validation
 * errors in the response's `validation.errors` array. The adapter lets
 * callers provide such platform-specific fields through
 * `CreateOfferCommand.overrides.platformParams` and passes them through here.
 */
export interface AllegroProductOfferCreateRequest extends Record<string, unknown> {
  name: string;
  category: { id: string };
  sellingMode: {
    price: { amount: string; currency: string };
    format: 'BUY_NOW';
  };
  stock: { available: number; unit: 'UNIT' };
  description?: {
    sections: Array<{
      items: Array<{ type: 'TEXT'; content: string }>;
    }>;
  };
  images?: Array<{ url: string }>;
  parameters?: Array<{ id: string; values?: string[]; valuesIds?: string[] }>;
  delivery?: { shippingRates?: { id: string }; handlingTime?: string };
  afterSalesServices?: {
    impliedWarranty?: { id: string };
    returnPolicy?: { id: string };
    warranty?: { id: string };
  };
  payments?: { invoice?: 'VAT' | 'NO_INVOICE' | 'VAT_MARGIN' };
  publication?: { status: 'INACTIVE' | 'ACTIVE' };
  external?: { id: string };
}

/**
 * Response from `POST /sale/product-offers`.
 */
export interface AllegroProductOfferCreateResponse {
  id: string;
  name?: string;
  publication?: { status?: AllegroOfferPublicationStatus };
  validation?: { errors?: AllegroValidationError[] };
  external?: { id?: string };
}

