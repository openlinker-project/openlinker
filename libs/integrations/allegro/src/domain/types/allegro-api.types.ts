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
 * Allegro checkout form (from GET /order/checkout-forms/{id}).
 *
 * The `delivery` block mirrors the Allegro swagger
 * `CheckoutFormDeliveryReference`. Today's adapter (`AllegroOrderSourceAdapter`)
 * consumes only `delivery.cost` (#454 — shipping totals) and `delivery.address`
 * (#457 — preferred shippingAddress source). The remaining fields are typed
 * proactively so #455 (carrier mapping → `method.id`) and #458
 * (pickup-point forwarding → `pickupPoint`) don't need to re-extend this
 * interface.
 */
export interface AllegroCheckoutForm {
  id: string;
  /**
   * Checkout-form transaction status. `CANCELLED` means the transaction
   * itself was voided (payment timeout, buyer-initiated cancellation before
   * a sale completes, etc). Other known values: `BOUGHT`, `FILLED_IN`,
   * `READY_FOR_PROCESSING`. Optional because older fixtures/mocks predate
   * this field; absence is treated as not-cancelled.
   */
  status?: string;
  /**
   * The SELLER's own delivery/fulfillment status — what the "Status
   * zamówienia" dropdown in Allegro's seller panel sets (`NOWE`,
   * `W_REALIZACJI`, `WSTRZYMANE`, `DO_WYSLANIA`, `DO_ODBIORU`, `WYSLANE`,
   * `ODEBRANE`, `ANULOWANE`/`CANCELLED`). `AllegroOrderSourceAdapter.write()`
   * also SETS this same field when relaying an externally-authored (e.g.
   * PrestaShop-side) cancellation INTO Allegro — reading it back out here to
   * detect a seller-initiated cancellation is safe despite that, because the
   * order-ingestion transition-gate (`priorStatus !== 'cancelled'`) already
   * suppresses a re-fire once OL's own record is cancelled.
   */
  fulfillment?: { status?: string };
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
  delivery?: {
    /** #455 — carrier mapping consumes `method.id`. Ignored in this adapter today. */
    method?: { id: string; name?: string };
    /** #454 — `cost.amount` is the per-order shipping cost. */
    cost?: { amount: string; currency: string };
    /**
     * #457 — preferred source for `shippingAddress`. May be present-but-empty
     * (`{}`) on pickup-point orders where the parcel ships to the locker, not
     * to a street address; the adapter guards against that case.
     */
    address?: {
      firstName?: string;
      lastName?: string;
      street?: string;
      city?: string;
      zipCode?: string;
      countryCode?: string;
      companyName?: string;
      phoneNumber?: string;
    };
    /** #458 — pickup-point (InPost locker etc.). Ignored in this adapter today. */
    pickupPoint?: {
      id: string;
      name?: string;
      description?: string;
      address?: {
        street?: string;
        zipCode?: string;
        city?: string;
        countryCode?: string;
      };
    };
    /** Allegro Smart! free-delivery flag. Ignored today. */
    smart?: boolean;
    /**
     * #927 — delivery/dispatch time windows. `dispatch.{from,to}` (the
     * shipment window, populated for all delivery methods) is the ship-by SLA
     * source; `dispatch.to` is the deadline. `time.{from,to}` is the delivery
     * window and `time.guaranteed` (deprecated, Kurier-X-press-only) is NOT
     * consumed. All bounds are ISO 8601 timestamps.
     */
    time?: {
      from?: string;
      to?: string;
      dispatch?: { from?: string; to?: string };
      guaranteed?: { from?: string; to?: string };
    };
  };
  /**
   * Last-revision timestamp of the checkout form (the only order-level date
   * Allegro returns). NOT a placed/created time — the buyer-placed time lives
   * on `lineItems[].boughtAt` (#926).
   */
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
  modification: {
    changeType: 'FIXED' | 'GAIN';
    value: number;
  };
  offerCriteria: Array<{
    offers: Array<{ id: string }>;
    type: 'CONTAINS_OFFERS';
  }>;
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
 * infers it from `id`). `rangeValue` carries integer/float range parameters
 * (#1071 — previously a documented gap; now emitted from the neutral
 * `OfferParameter.rangeValue` operator-supplied path).
 */
export interface AllegroOfferParameter {
  id: string;
  name?: string;
  values?: string[];
  valuesIds?: string[];
  rangeValue?: { from: string; to: string };
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
    /**
     * Existing Allegro product-card id. Set on the smart-link path (#431) —
     * presence of `id` means the entry references an existing card and
     * Allegro inherits `name`, `parameters`, `images`, and GPSR data from
     * the card. The inline-product path leaves `id` undefined and supplies
     * those fields explicitly alongside `responsibleProducer` /
     * `safetyInformation` on the entry.
     */
    id?: string;
    name?: string;
    parameters?: AllegroOfferParameter[];
    images?: string[];
  };
  /**
   * How many units of the catalog product one offer item contains
   * (`quantity.value`, default 1 - Allegro uses it for bundles/sets).
   * Read-side field consumed by `getOffer` (#1482); the create path never
   * sets it.
   */
  quantity?: { value?: number };
  /**
   * EU GPSR (Reg. 2023/988) responsible-producer reference. Required by
   * Allegro on every `productSet[]` entry when the entry creates an inline
   * product (no `product.id`). Smart-linked entries inherit this from the
   * referenced card and may omit it. See #430.
   */
  responsibleProducer?: { id: string };
  /**
   * EU GPSR safety information. Same applicability as `responsibleProducer`:
   * required on the inline path, inherited on the smart-link path.
   * Discriminator + sibling fields verified against
   * developer.allegro.pl (#445):
   * - `NO_SAFETY_INFORMATION` — declares no safety info applies. Forbidden
   *   in some categories (cameras / electronics / etc.) — Allegro then
   *   returns `NO_SAFETY_INFORMATION_OPTION_NOT_ALLOWED`.
   * - `TEXT` + `description` — free-text 1–5000 chars, no HTML, `\n` allowed.
   * - `ATTACHMENTS` + `attachments[].id` — max 20 entries.
   */
  safetyInformation?:
    | { type: 'NO_SAFETY_INFORMATION' }
    | { type: 'TEXT'; description: string }
    | { type: 'ATTACHMENTS'; attachments: Array<{ id: string }> };
}

/**
 * Allegro product offer (from GET /sale/product-offers/{offerId})
 *
 * Fields required by the existing `fetchOfferIdentifiers` (#411) consumer
 * are baseline; the additional optional fields below are consumed by
 * `getOffer` (#464) to populate the neutral `MarketplaceOffer` DTO. Optional
 * because Allegro's response shape varies — synced-in offers may have empty
 * `images[]` or no `description.sections[]`.
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
  /** #464 — primary description, structured by Allegro as a list of sections of items. */
  description?: {
    sections?: Array<{
      items?: Array<{
        type?: string;
        content?: string;
        url?: string;
      }>;
    }>;
  };
  /** #464 — primary image is the first entry; subsequent entries are gallery shots. */
  images?: Array<{ url: string }>;
  /** #464 — current selling price. `BUY_NOW` is the only mode we currently consume. */
  sellingMode?: {
    price?: { amount: string; currency: string };
  };
  /** #464 — available stock quantity reported by Allegro. */
  stock?: {
    available?: number;
  };
  /**
   * #464 — publication lifecycle (ACTIVE / ENDED / INACTIVE / etc.).
   * #447 — also read by the offer-creation poller via
   * `OfferStatusReader.getOfferStatus`. The status enum is typed strictly
   * to keep the poller's exhaustive-switch checks honest; consumers that
   * only need to display it (#464) cast through `string`.
   */
  publication?: {
    status?: AllegroOfferPublicationStatus;
    endingAt?: string;
  };
  /**
   * Validation errors returned alongside the offer resource. Mirrors the
   * shape returned on `POST /sale/product-offers` 2xx-with-errors responses;
   * the same array can appear here once Allegro finishes async validation
   * (#447).
   */
  validation?: { errors?: AllegroValidationError[] };
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
 *
 * `location`, `productSet`, and `afterSalesServices` are populated **only** by
 * `AllegroOfferManagerAdapter.buildSellerDefaultsPatch` on the PATCH path
 * (#487). They are not surfaced through the neutral `UpdateOfferFieldsCommand`
 * shape — callers do not set them. The adapter merges them in opportunistically
 * because Allegro re-validates the whole offer on every PATCH and a description-
 * only update will 422 if the offer happens to be missing GPSR / location /
 * after-sales fields. Caller-supplied fields always win on overlap.
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
  /** Backfilled from `sellerDefaults.location` (#487). */
  location?: AllegroProductOfferCreateRequest['location'];
  /** Backfilled from `sellerDefaults.responsibleProducerId` + `safetyInformation` (#487). */
  productSet?: AllegroProductSetEntry[];
  /** Reserved for the after-sales backfill follow-up (#487). No connection-level storage exists yet. */
  afterSalesServices?: AllegroProductOfferCreateRequest['afterSalesServices'];
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
  /**
   * Ship-from address. Required for every offer regardless of inline vs
   * smart-link path (#430 — sandbox 422 on `location.state` was the
   * original trigger). Sourced from `Connection.config.allegro
   * .sellerDefaults.location` at offer-build time.
   */
  location?: {
    countryCode: string;
    province: string;
    city: string;
    postCode: string;
  };
}

/**
 * One entry in `GET /sale/products?phrase=…&category.id=…` (#431) and
 * `GET /sale/products?phrase={ean}&mode=GTIN` (#735). Allegro's matcher is
 * fuzzy on `phrase`, so callers post-filter by exact-EAN match. `name` is
 * informational (used in logs and the `ambiguous` diagnostic payload). The
 * summary response intentionally does NOT carry image URLs — only the detail
 * endpoint (`GET /sale/products/{productId}`) does.
 *
 * Swagger reference: `BaseSaleProductResponseDto` lists `id`, `name`, `category`
 * as required + `parameters` (and others) as optional. The `category.path`
 * sub-field is intentionally omitted from the typed shape until a reader
 * needs it.
 */
export interface AllegroProductCardSummary {
  id: string;
  name?: string;
  ean?: string;
  /**
   * Category the card lives under in Allegro's catalogue. Used by
   * `resolveCategoriesForBatchByEan` (#735) to pre-fill bulk-listing
   * review-table rows.
   */
  category?: { id: string };
  /**
   * Product parameters as returned by the catalogue search endpoint. The
   * GTIN-bearing entry (`options.isGTIN === true`) is the canonical place
   * Allegro reports the EAN; see `AllegroProductDtoParameter`.
   */
  parameters?: AllegroProductDtoParameter[];
}

export interface AllegroProductsSearchResponse {
  products: AllegroProductCardSummary[];
}

/**
 * Subset of `SaleProductDto` returned by `GET /sale/products/{productId}` that
 * the catalog-product reader (#633) maps onto the neutral `CatalogProduct`.
 * Other fields (offerRequirements, compatibilityList, tecdocSpecification,
 * trustedContent, productSafety, etc.) are intentionally omitted — they are
 * not surfaced through the neutral DTO.
 *
 * Reference: developer.allegro.pl/swagger.yaml SaleProductDto.
 */
export interface AllegroProductDto {
  id: string;
  name: string;
  images?: { url: string }[];
  parameters?: AllegroProductDtoParameter[];
}

/**
 * `ProductParameterDto` entry as returned by the catalog endpoints. Mirrors
 * the offer-parameter shape but is read-only (no `rangeValue` write path).
 * `options.isGTIN === true` marks the EAN-bearing parameter; we use that to
 * surface a top-level `ean` on the neutral summary.
 */
export interface AllegroProductDtoParameter {
  id: string;
  name?: string;
  values?: string[];
  valuesIds?: string[];
  unit?: string;
  options?: {
    identifiesProduct?: boolean;
    isGTIN?: boolean;
  };
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
 * One entry returned by Allegro's `GET /sale/responsible-producers`. The
 * registry is the EU GPSR (Reg. 2023/988) operator-side list of producers
 * the seller can declare on offer creation. Adapter surfaces this through
 * the `ResponsibleProducerReader` capability for the FE settings dropdown
 * (#430).
 */
export interface AllegroResponsibleProducerEntry {
  id: string;
  name?: string;
  type?: 'PRODUCER' | 'IMPORTER' | 'AUTHORIZED_REPRESENTATIVE' | 'FULFILLMENT_SERVICE_PROVIDER';
}

export interface AllegroResponsibleProducersResponse {
  responsibleProducers: AllegroResponsibleProducerEntry[];
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
 * Response from `GET /sale/shipping-rates/{id}` — the **detailed** per-rate-
 * table view (#472). The top-level list endpoint (`/sale/shipping-rates`)
 * returns rate-table identifiers and names; this per-id endpoint returns the
 * full rate table including the underlying carrier methods.
 *
 * Each `rates[].deliveryMethod` entry carries the seller-stable Allegro
 * carrier-method identity (e.g. `1fa56f79-…` for "Allegro Paczkomaty InPost")
 * used by the order-checkout-form `delivery.method.id` field. This is the
 * layer #474's `listDeliveryMethods()` flattens + dedupes from across all
 * rate-tables.
 *
 * #494: the previous declaration named the field `method`, which doesn't
 * match the schema documented at developer.allegro.pl/documentation#operation/getShippingRateUsingGET.
 * The resulting empty-dropdown bug went undetected because the unit-test
 * fixtures used the same wrong shape.
 */
export interface AllegroShippingRateDetailResponse {
  id: string;
  name: string;
  rates?: Array<{
    deliveryMethod?: {
      id: string;
      name?: string;
    };
  }>;
}

/**
 * Response from `GET /sale/delivery-methods` — the canonical catalogue of
 * delivery methods available to the seller, with their human-readable names
 * (#496). Used by `listDeliveryMethods()` to resolve the bare method-ids
 * returned by the rate-table walk into operator-friendly labels in the
 * carrier-mapping dropdown.
 *
 * Per developer.allegro.pl/news/get-sale-delivery-methods-dodatkowe-informacje-o-metodach-dostawy-E7Zbq7OBnSE
 * the response includes `marketplaces`, `dispatchCountry`, and
 * `destinationCountry` per entry; we currently only consume `id` and `name`,
 * but the full shape is declared so future filtering (e.g. dispatch-country
 * scoping) doesn't need a type change.
 */
export interface AllegroDeliveryMethodsResponse {
  deliveryMethods: Array<{
    id: string;
    name: string;
    marketplaces?: string[];
    dispatchCountry?: string | null;
    destinationCountry?: string | null;
  }>;
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

/**
 * Response from `GET /sale/offers/{offerId}/smart` (#737) — Allegro Smart!
 * classification report. The neutral `SmartClassificationReport` type in
 * core (`libs/core/src/listings/domain/types/smart-classification.types.ts`)
 * is the consumer surface; this raw shape is mapped onto it by
 * `AllegroOfferManagerAdapter.getOfferSmartClassification`.
 *
 * Deprecated fields documented in the swagger (`smartDeliveryMethods`,
 * `passedDeliveryMethods`, `failedDeliveryMethods`) are intentionally
 * omitted — slated for removal 2026-07-28 per Allegro changelog.
 *
 * Reference: developer.allegro.pl/swagger.yaml SmartOfferClassificationReport.
 */
export interface AllegroSmartOfferClassificationReport {
  classification?: {
    fulfilled: boolean;
    lastChanged?: string;
  };
  scheduledForReclassification?: boolean;
  conditions?: Array<{
    code: string;
    name: string;
    description: string;
    fulfilled: boolean;
  }>;
}
