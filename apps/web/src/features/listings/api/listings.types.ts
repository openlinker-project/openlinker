/**
 * Listings Feature Types
 *
 * Frontend transport types for the listings (offer mapping) API. Mirrors the
 * backend OfferMappingResponseDto and PaginatedOfferMappingsResponseDto contracts.
 * All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/listings/api
 */

/**
 * Known mapping entity types. The wire value is a plain string — unknown
 * values pass through unchanged (UI falls back to non-linkified text) so this
 * list stays forward-compatible with new backend entity kinds.
 */
export const KNOWN_MAPPING_ENTITY_TYPES = ['Product', 'ProductVariant', 'InventoryItem'] as const;
export type KnownMappingEntityType = (typeof KNOWN_MAPPING_ENTITY_TYPES)[number];

export interface OfferMapping {
  id: string;
  entityType: string;
  internalId: string;
  externalId: string;
  platformType: string;
  connectionId: string;
  context: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Populated only by the detail endpoint (`GET /listings/:id`) for Offer-type
   * mappings that originated from an OL-initiated create. Always absent on
   * list responses — the list endpoint does not fan out lookups per row.
   * Absent on synced-in offers and on non-Offer entity types.
   */
  offerCreation?: OfferCreationStatusResponse | null;
  /**
   * Internal product ID owning the linked variant. Populated only by the
   * detail endpoint (`GET /listings/:id`) for Offer-type mappings whose
   * `internalId` resolves to an existing variant. Drives the AI-suggest
   * flow on the offer-edit drawer (#485) — the suggest endpoint is keyed
   * on product, not variant. Absent on list responses, synced-in offers
   * whose variant has been deleted, and non-Offer entity types.
   */
  linkedProductId?: string | null;
}

export interface ListingsFilters {
  connectionId?: string;
  platformType?: string;
  internalId?: string;
  search?: string;
}

export interface ListingsPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedOfferMappings {
  items: OfferMapping[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Live marketplace-side offer state surfaced on the listing detail page (#464).
 * Mirrors the backend `MarketplaceOfferResponseDto`. `status` is a string
 * passthrough — different marketplaces use different lifecycle vocabularies
 * (Allegro: `ACTIVE` / `ENDED` / `INACTIVE` / `BIDDING`); the FE renders
 * known values with a tone and falls back to a neutral badge for the rest.
 */
export interface MarketplaceOfferPrice {
  amount: string;
  currency: string;
}

export interface MarketplaceOfferCategory {
  id: string;
  name?: string;
}

export interface MarketplaceOfferResponse {
  externalId: string;
  title: string;
  description?: string;
  imageUrl?: string;
  price: MarketplaceOfferPrice;
  availableQuantity: number;
  status: string;
  category?: MarketplaceOfferCategory;
  marketplaceUrl?: string;
  /**
   * ISO 8601 — when the offer's marketplace-side validity ends (Allegro:
   * `publication.endingAt`). Optional because not every marketplace publishes
   * a fixed end date.
   */
  endsAt?: string;
}

export interface UpdateOfferDescriptionSectionItem {
  type: 'TEXT';
  content: string;
}

export interface UpdateOfferDescriptionSection {
  items: UpdateOfferDescriptionSectionItem[];
}

export interface UpdateOfferFieldsPayload {
  price?: { amount: string; currency: string };
  title?: string;
  description?: { sections: UpdateOfferDescriptionSection[] };
}

export interface UpdateOfferFieldsResult {
  jobId: string;
}

/**
 * OL-initiated offer creation lifecycle status.
 *
 * Mirrors `OfferCreationStatus` on the backend. Terminal values are
 * `'draft'`, `'active'`, and `'failed'` — the tracker stops polling on
 * those. `'draft'` is terminal because Allegro accepted the offer (it's
 * sitting in the seller panel awaiting manual publish); OL will not
 * transition it. `'validating'` stays non-terminal until the
 * `marketplace.offer.pollCreationStatus` follow-up handler lands. (#407)
 */
export const OfferCreationStatusValues = [
  'pending',
  'draft',
  'validating',
  'active',
  'failed',
] as const;
export type OfferCreationStatus = (typeof OfferCreationStatusValues)[number];

export const TERMINAL_OFFER_CREATION_STATUSES: readonly OfferCreationStatus[] = [
  'draft',
  'active',
  'failed',
];

export interface OfferCreationError {
  field?: string;
  code: string;
  message: string;
}

export interface CreateOfferPrice {
  amount: number;
  currency: string;
}

export interface CreateOfferOverrides {
  title?: string;
  description?: string | null;
  categoryId?: string;
  imageUrls?: string[] | null;
  platformParams?: Record<string, unknown>;
}

export interface CreateOfferRequest {
  internalVariantId: string;
  stock: number;
  publishImmediately: boolean;
  price?: CreateOfferPrice;
  overrides?: CreateOfferOverrides;
  /**
   * Snapshot schema version. Absent on request submits (the wizard does
   * not populate it — the backend stamps it at persist time). Present on
   * the `request` field embedded in `OfferCreationStatusResponse`. FE
   * consumers must treat any unknown version as "cannot safely pre-fill"
   * and fall back to an empty wizard.
   */
  schemaVersion?: number;
}

/** The only snapshot schema version this client knows how to read. */
export const SUPPORTED_OFFER_CREATION_REQUEST_SCHEMA_VERSION = 1;

export interface CreateOfferResponse {
  jobId: string;
  offerCreationRecordId: string;
}

export interface OfferCreationStatusResponse {
  id: string;
  internalVariantId: string;
  connectionId: string;
  externalOfferId: string | null;
  status: OfferCreationStatus;
  errors: OfferCreationError[] | null;
  publishImmediately: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * Snapshot of the original create-offer request payload. Drives the
   * wizard retry pre-fill on a failed record. Null when the record
   * predates this field or when the snapshot schema version is unknown
   * to this client — consumers must tolerate null and degrade gracefully.
   */
  request?: CreateOfferRequest | null;
}

export interface SellerPolicy {
  id: string;
  name: string;
}

export interface SellerPoliciesResponse {
  deliveryPolicies: SellerPolicy[];
  returnPolicies: SellerPolicy[];
  warranties: SellerPolicy[];
  impliedWarranties: SellerPolicy[];
}

/** ----- Category parameters (#410) ----------------------------------------
 *
 * Marketplace-neutral shape for category parameters returned by
 * `GET /listings/connections/:connectionId/categories/:categoryId/parameters`.
 * Mirrors the backend `CategoryParameter` 1:1 — no transport-level remapping.
 *
 * Two distinct dependency mechanisms surface separately:
 *   - parameter-level visibility (`dependsOn`) — show/hide the whole field
 *   - dictionary-entry filtering (`dictionary[i].dependsOnValueIds`) —
 *     filter individual options inside an already-visible field
 *
 * The wizard renderer uses both: `dependsOn` to skip rendering, the
 * per-entry list to filter dictionary options once the parent has a value.
 * --------------------------------------------------------------------- */

export const CategoryParameterTypeValues = [
  'dictionary',
  'string',
  'integer',
  'float',
] as const;
export type CategoryParameterType = (typeof CategoryParameterTypeValues)[number];

/**
 * Wire-shape section the parameter belongs to (#415). `'product'` parameters
 * travel under `body.product.parameters[]` on Allegro offer creation;
 * `'offer'` under `body.parameters[]`. The wizard renders both kinds in one
 * unified list — the split happens at submit time via the serializer.
 */
export const CategoryParameterSectionValues = ['offer', 'product'] as const;
export type CategoryParameterSection = (typeof CategoryParameterSectionValues)[number];

export interface CategoryParameterDictionaryEntry {
  id: string;
  value: string;
  dependsOnValueIds?: string[];
}

export interface CategoryParameterRestrictions {
  multipleChoices?: boolean;
  range?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  precision?: number;
  /** Maximum number of values the user may submit. `1` = single, `2+` = bounded multi. */
  allowedNumberOfValues?: number;
  /** Dictionary allows free-text entries alongside the dictionary list (combobox). */
  customValuesEnabled?: boolean;
}

export interface CategoryParameterDependsOn {
  parameterId: string;
  valueIds: string[];
}

/**
 * Cache-bust version for the category-parameters TanStack Query response shape.
 *
 * **BUMP THIS** every time the `CategoryParameter` interface gains a new
 * required field (or removes one), so every browser's in-flight TanStack
 * Query cache for this endpoint is invalidated on next deploy.
 *
 * Why: the FE caches the categoryParameters response for 24h (see
 * `useCategoryParametersQuery`'s `staleTime`). When a required field is
 * added to the interface, browsers holding pre-bump cached responses serve
 * stale data that violates the type contract — causing the
 * `MissingCategoryParameterSectionError` throw in `serializeAllegroParameters`
 * (the runtime backstop). Bumping this constant routes around the staleness
 * by changing the queryKey, so old caches become orphaned and a fresh fetch
 * is forced.
 *
 * Bump history:
 *   - 2 (#423, 2026-04): post-#417 schema with `section: 'offer' | 'product'`.
 *   - 1 (implicit): pre-#417 schema without `section`.
 *
 * @see {@link CategoryParameter}
 * @see #423 for the original cache-staleness incident.
 */
export const CATEGORY_PARAMETERS_SCHEMA_VERSION = 2;

export interface CategoryParameter {
  id: string;
  name: string;
  type: CategoryParameterType;
  required: boolean;
  unit?: string;
  dictionary?: CategoryParameterDictionaryEntry[];
  restrictions: CategoryParameterRestrictions;
  /** Parameter-level visibility — see file header. */
  dependsOn?: CategoryParameterDependsOn;
  /** Wire-shape section (#415). Drives the offer/product split at submit time. */
  section: CategoryParameterSection;
}

export interface CategoryParametersListResponse {
  parameters: CategoryParameter[];
}
