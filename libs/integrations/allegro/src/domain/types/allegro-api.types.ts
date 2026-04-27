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
 * Allegro offer parameter entry. Used both as a GET payload field (from
 * `GET /sale/product-offers/{offerId}` — `name` is populated server-side)
 * and as a POST request shape (`body.parameters[]` /
 * `body.productSet[].product.parameters[]` — adapters omit `name`, Allegro
 * infers it from `id`). Allegro's actual POST API also accepts
 * `rangeValue?: { from, to }` here; the adapter's shape validator
 * (`isAllegroOfferParameterShape`) currently filters that branch out —
 * pre-existing gap, tracked separately.
 */
export interface AllegroOfferParameter {
  id: string;
  name?: string;
  values?: string[];
  valuesIds?: string[];
}

/**
 * One entry in `body.productSet[]` on `POST /sale/product-offers` and in the
 * `productSet[]` field returned by `GET /sale/product-offers/{offerId}`.
 *
 * On POST, Allegro requires `product.name` and `product.images` (≥1) when
 * creating an inline product — no existing `product.id` to inherit from.
 * The adapter mirrors `body.name` and `body.images` onto the product entry;
 * see #419 §4.2 for the MVP coupling rationale and #412 for the smart-link
 * follow-up that revisits this.
 *
 * **Two-phase population in `AllegroOfferManagerAdapter`**: `name` and
 * `parameters` are written by `applyPlatformParams` while building the
 * request body; `images` is mirrored later in `createOffer`, *after* the
 * image-upload step rewrites `body.images` to Allegro CDN URLs. Doing the
 * `images` copy in `applyPlatformParams` would leak the pre-upload operator
 * URL into the inline product, which Allegro rejects.
 */
export interface AllegroProductSetEntry {
  product?: {
    name?: string;
    parameters?: AllegroOfferParameter[];
    images?: string[];
  };
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
  productSet?: AllegroProductSetEntry[];
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
 * Allegro category parameter — raw shape from
 * GET /sale/categories/{categoryId}/parameters
 *
 * Surfaces both dependency mechanisms separately:
 *   - parameter-level visibility (`options.dependsOnParameterId`)
 *   - dictionary-entry filtering (`dictionary[i].dependsOnParameterValueIds`)
 *
 * `requiredIf` / `displayedIf` are richer JSONPath-ish predicates that the
 * adapter does not currently surface to CORE — kept here for traceability
 * when capturing fixtures.
 */
export interface AllegroCategoryParameter {
  id: string;
  name: string;
  type: 'dictionary' | 'string' | 'integer' | 'float';
  required: boolean;
  requiredForProduct?: boolean;
  requiredIf?: unknown;
  displayedIf?: unknown;
  unit?: string;
  options?: {
    ambiguousValueId?: string;
    dependsOnParameterId?: string;
    describesProduct?: boolean;
    customValuesEnabled?: boolean;
  };
  dictionary?: Array<{
    id: string;
    value: string;
    /**
     * Entry-level dependency. Allegro's field name is exactly `dependsOnValueIds`
     * (not `dependsOnParameterValueIds`). When non-empty, this entry is only
     * selectable when the parent parameter (identified by the parameter's
     * `options.dependsOnParameterId`) has one of these value IDs.
     */
    dependsOnValueIds?: string[];
    /** Legacy migration data on individual entries — adapter ignores. */
    formerData?: unknown;
  }>;
  restrictions?: {
    multipleChoices?: boolean;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    range?: boolean;
    precision?: number;
    /** Numeric — e.g. 1 for single value, 5 / 20 for capped multi-value strings. */
    allowedNumberOfValues?: number;
  };
  /** Legacy migration data — adapter ignores. */
  formerData?: unknown;
}

/**
 * Allegro category parameters response (from GET /sale/categories/{categoryId}/parameters)
 */
export interface AllegroCategoryParametersResponse {
  parameters: AllegroCategoryParameter[];
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
  images?: string[];
  parameters?: AllegroOfferParameter[];
  /**
   * Product-section parameters (#415 / #419). Allegro splits category
   * parameters into "describes the offer" (`body.parameters[]`) and
   * "describes the product itself" — Brand, Model, Manufacturer-code —
   * which travel under `body.productSet[].product.parameters[]`. The same
   * shape Allegro returns from `GET /sale/product-offers/{offerId}`. The
   * earlier #415 fix used a top-level `body.product` field which Allegro
   * rejects with `UnknownJSONProperty`; this is the corrected shape.
   */
  productSet?: AllegroProductSetEntry[];
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

/**
 * Seller-configured policy entry returned by the four Allegro after-sales /
 * delivery endpoints. All four endpoints return entries sharing an `id` +
 * `name` shape (plus platform-specific metadata the adapter does not need).
 */
export interface AllegroSellerPolicyEntry {
  id: string;
  name: string;
}

/**
 * Response from `GET /sale/shipping-rates`.
 *
 * Allegro wraps the seller-configured shipping-rate sets (user-facing
 * "delivery methods" in the seller UI) under the `shippingRates` key. These
 * are the IDs that `POST /sale/product-offers` expects at
 * `delivery.shippingRates.id` — the namespace is the same, which is why the
 * wizard round-trip is internally consistent once we fetch from the right
 * endpoint. Note: `/sale/delivery-settings` is a *different* Allegro
 * resource returning a single account-level config object (free-delivery
 * threshold, join-policy) — unrelated to this list.
 */
export interface AllegroShippingRatesResponse {
  shippingRates: AllegroSellerPolicyEntry[];
}

/**
 * Response from `GET /after-sales-service-conditions/return-policies`.
 */
export interface AllegroReturnPoliciesResponse {
  returnPolicies: AllegroSellerPolicyEntry[];
}

/**
 * Response from `GET /after-sales-service-conditions/warranties`.
 */
export interface AllegroWarrantiesResponse {
  warranties: AllegroSellerPolicyEntry[];
}

/**
 * Response from `GET /after-sales-service-conditions/implied-warranties`.
 */
export interface AllegroImpliedWarrantiesResponse {
  impliedWarranties: AllegroSellerPolicyEntry[];
}

