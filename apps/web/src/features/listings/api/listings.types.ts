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
  // The offer already existed on the platform — an idempotent create the adapter
  // resolved (e.g. Erli's seller-keyed 409, #1096). A terminal success, distinct
  // from `draft` so a re-run doesn't read as a fresh create.
  'reused',
  'failed',
] as const;
export type OfferCreationStatus = (typeof OfferCreationStatusValues)[number];

export const TERMINAL_OFFER_CREATION_STATUSES: readonly OfferCreationStatus[] = [
  'draft',
  'active',
  'reused',
  'failed',
];

export interface OfferCreationError {
  field?: string;
  code: string;
  message: string;
}

/**
 * Live marketplace publication status (#1760) — mirrors the backend neutral
 * `OfferPublicationStatus`. Distinct from `OfferCreationStatus`: this is the
 * steady-state status persisted in `offer_status_snapshots`, not OL's one-shot
 * creation lifecycle. `'active'`/`'ended'` are terminal publications;
 * `'activating'`/`'inactivating'` are transient async states.
 */
export const OfferPublicationStatusValues = [
  'active',
  'activating',
  'inactivating',
  'inactive',
  'ended',
] as const;
export type OfferPublicationStatus = (typeof OfferPublicationStatusValues)[number];

/** One offer's persisted live publication status for a product (#1760). */
export interface OfferPublicationStatusResponse {
  connectionId: string;
  externalOfferId: string;
  internalVariantId: string;
  publicationStatus: OfferPublicationStatus;
  validationMessages?: string[];
  /** ISO 8601 timestamp of the last marketplace read. */
  lastStatusSyncedAt: string;
}

/** Response of the manual single-offer refresh (#1760). */
export interface RefreshOfferPublicationStatusResponse {
  publicationStatus: OfferPublicationStatus;
}

export interface CreateOfferPrice {
  amount: number;
  currency: string;
}

/**
 * Neutral, section-tagged offer/category parameter (#1071) — mirrors the
 * backend `OfferParameter` domain shape. The wizard emits these on
 * `overrides.parameters`; the Allegro adapter splits them by `section` into
 * the offer/product wire arrays. Replaces the legacy Allegro-shaped
 * `platformParams.parameters` / `platformParams.productParameters`.
 */
export interface OfferParameter {
  id: string;
  values?: string[];
  valuesIds?: string[];
  rangeValue?: { from: string; to: string };
  section: CategoryParameterSection;
}

export interface CreateOfferOverrides {
  title?: string;
  description?: string | null;
  categoryId?: string;
  /**
   * Catalogue product-card id resolved from the variant barcode (#808).
   * Threaded through so smart-linking adapters link the existing card and
   * inherit its required product parameters instead of creating one inline.
   */
  productCardId?: string;
  imageUrls?: string[] | null;
  /**
   * Operator-picked neutral category parameters (#1071). The BE merges these
   * with attribute projection and the adapter shapes them to platform wire.
   */
  parameters?: OfferParameter[];
  /** Un-modeled platform knobs only (policy ids, etc.) — NOT category params. */
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

/** ----- Shop publish (#1044) ---------------------------------------------
 *
 * Transport types for the shop-publish endpoints. A shop product is published
 * from an OL canonical variant onto a `ProductPublisher`-capable connection
 * (today: WooCommerce). Mirrors the BE controller contract — see the issue
 * body. Single and bulk share the same per-record status shape.
 * --------------------------------------------------------------------- */

/**
 * Per-record publish lifecycle status. Terminal values are `'draft'`,
 * `'published'`, and `'failed'` — the tracker stops polling on those.
 */
export const ShopPublishStatusValues = ['pending', 'draft', 'published', 'failed'] as const;
export type ShopPublishStatus = (typeof ShopPublishStatusValues)[number];

export const TERMINAL_SHOP_PUBLISH_STATUSES: readonly ShopPublishStatus[] = [
  'draft',
  'published',
  'failed',
];

export interface ShopPublishError {
  field?: string;
  code: string;
  message: string;
}

export interface ShopPublishPrice {
  amount: number;
  currency: string;
}

export interface ShopPublishContent {
  title?: string;
  description?: string;
  imageUrls?: string[];
}

export interface ShopPublishRequest {
  internalVariantId: string;
  status: 'draft' | 'published';
  stock: number;
  price?: ShopPublishPrice;
  content?: ShopPublishContent;
}

export interface ShopPublishResponse {
  jobId: string;
  listingCreationRecordId: string;
}

export interface ShopPublishStatusResponse {
  id: string;
  internalVariantId: string;
  connectionId: string;
  status: ShopPublishStatus;
  externalProductId: string | null;
  bulkBatchId: string | null;
  errors: ShopPublishError[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface BulkShopPublishItemRequest {
  internalVariantId: string;
  stock: number;
  price?: ShopPublishPrice;
}

export interface BulkShopPublishRequest {
  connectionId: string;
  items: BulkShopPublishItemRequest[];
  status: 'draft' | 'published';
  content?: ShopPublishContent;
}

export interface BulkShopPublishItem {
  internalVariantId: string;
  jobId: string;
  listingCreationRecordId: string;
}

export interface BulkShopPublishResponse {
  batchId: string;
  items: BulkShopPublishItem[];
}

export const BulkShopPublishBatchStatusValues = [
  'pending',
  'running',
  'completed',
  'partially-failed',
  'failed',
] as const;
export type BulkShopPublishBatchStatus = (typeof BulkShopPublishBatchStatusValues)[number];

export const TERMINAL_BULK_SHOP_PUBLISH_STATUSES: readonly BulkShopPublishBatchStatus[] = [
  'completed',
  'partially-failed',
  'failed',
];

export interface BulkShopPublishBatchResponse {
  id: string;
  connectionId: string;
  status: BulkShopPublishBatchStatus;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
  records: ShopPublishStatusResponse[];
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

/** ----- Responsible producers (#1531) -------------------------------------
 *
 * A seller-configured EU GPSR responsible-producer ("producent") returned by
 * `GET /listings/connections/:connectionId/responsible-producers`, fetched live
 * from the marketplace. The offer-creation wizard renders these so the operator
 * can attach one and the created product is not blocked for a missing producer.
 */
export interface ResponsibleProducer {
  id: string;
  name: string;
  kind: string;
}

export interface ResponsibleProducersResponse {
  responsibleProducers: ResponsibleProducer[];
}

/** ----- Delivery price lists (#1530) --------------------------------------
 *
 * A seller-configured delivery price list ("cennik dostawy") returned by
 * `GET /listings/connections/:connectionId/delivery-price-lists`, fetched live
 * from the marketplace. The offer-creation wizard renders these so the operator
 * can attach one and the created offer is buyable.
 */
export interface DeliveryPriceList {
  id: string;
  name: string;
}

export interface DeliveryPriceListsResponse {
  deliveryPriceLists: DeliveryPriceList[];
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

export const CategoryParameterTypeValues = ['dictionary', 'string', 'integer', 'float'] as const;
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
 * `MissingCategoryParameterSectionError` throw in
 * `categoryParametersToOfferParameters` (the runtime backstop). Bumping this
 * constant routes around the staleness
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

/**
 * One node of a category breadcrumb, ordered root -> leaf (#1752). Mirrors the
 * BE `CategoryPathResponseDto` 1:1.
 */
export interface CategoryPathSegment {
  id: string;
  name: string;
}

export interface CategoryPathResponse {
  path: CategoryPathSegment[];
}

/**
 * Catalog product types — mirror the neutral BE shapes from
 * `@openlinker/core/listings` (#633). Preserve backend `camelCase`.
 */
export const CATALOG_PRODUCT_MATCH_KIND_VALUES = ['unique', 'ambiguous', 'no_match'] as const;
export type CatalogProductMatchKind = (typeof CATALOG_PRODUCT_MATCH_KIND_VALUES)[number];

export interface CatalogProductParameter {
  /** Stable id; matches `CategoryParameter.id`. Use as merge key on prefill. */
  parameterId: string;
  name: string;
  valueIds?: string[];
  valueStrings?: string[];
}

export interface CatalogProductSummary {
  id: string;
  name: string;
  ean?: string;
  imageUrl?: string;
}

export interface CatalogProduct extends CatalogProductSummary {
  description?: string;
  images?: string[];
  parameters: CatalogProductParameter[];
}

export type CatalogProductMatchResult =
  | { kind: 'unique'; product: CatalogProduct }
  | { kind: 'ambiguous'; products: CatalogProductSummary[] }
  | { kind: 'no_match' };

export interface FindProductsByBarcodeRequest {
  barcode: string;
  categoryId?: string;
}

/**
 * Request body for `POST /listings/connections/:connectionId/categories/resolve`
 * (#631). Mirrors the BE `ResolveCategoryRequestDto`. Fields stay camelCase to
 * preserve the BE contract (per `frontend-architecture.md`).
 */
export interface ResolveCategoryRequest {
  /** EAN/GTIN barcode for auto-detect (step 1). Omit to skip auto-detect. */
  barcode?: string | null;
  /**
   * Source-platform category IDs (deepest-first) for the mapping fallback.
   * Not used by the wizard today — kept on the type so the FE can grow into
   * it without a second migration when source-category info becomes available.
   */
  sourceCategoryIds?: string[];
}

/**
 * Mirrors the BE `CategoryResolutionMethodValues` shipped from
 * `@openlinker/core/listings/application/types/category-resolution.types.ts`.
 * Duplicated FE-side per #591 — apps/web is a browser bundle and the
 * established FE convention is local types under each feature's `api/`
 * folder (see `CategoryParameter` above). If the BE grows a 4th method, TS
 * narrowing on the response fails-fast at the wizard's
 * `resolvedCategoryHint(...)` and both sides need a one-line edit in lockstep.
 */
export const CategoryResolutionMethodValues = [
  'auto_detect',
  'category_mapping',
  'manual',
] as const;

export type CategoryResolutionMethod = (typeof CategoryResolutionMethodValues)[number];

/**
 * Response from `POST /listings/connections/:connectionId/categories/resolve`
 * (#631). Mirrors the BE `ResolveCategoryResponseDto`.
 */
export interface ResolveCategoryResponse {
  /** Resolved marketplace category ID, or null if manual pick is needed. */
  allegroCategoryId: string | null;
  /** Which step of the 3-step fallback produced the result. */
  method: CategoryResolutionMethod;
}

/**
 * Per-variant outcome of the batch EAN→category resolve (#795). Mirrors the BE
 * `EanMatchResult` discriminated union from `@openlinker/core/listings`
 * (duplicated FE-side per #591 — same convention as `CategoryResolutionMethod`
 * above). The richer envelope (vs single-resolve's flat shape) carries the
 * `multi-match` candidate list the bulk-wizard edit modal surfaces (#740 / #792).
 */
export const EanMatchResultKindValues = ['matched', 'multi-match', 'no-ean', 'no-match'] as const;
export type EanMatchResultKind = (typeof EanMatchResultKindValues)[number];

export interface EanMatchCandidate {
  allegroCategoryId: string;
  productCardId: string;
  /** Allegro display name for the candidate-picker chip. */
  name?: string;
}

/**
 * How a `matched` batch result was resolved (#1522). Absent ⇒ `auto_detect`
 * (an EAN catalogue match). `category_mapping` marks a result produced by the
 * configured per-source-category mapping fallback (no catalogue card).
 */
export type EanMatchMethod = 'auto_detect' | 'category_mapping';

export type EanMatchResult =
  | { kind: 'matched'; allegroCategoryId: string; productCardId: string; method?: EanMatchMethod }
  | { kind: 'multi-match'; candidates: EanMatchCandidate[] }
  | { kind: 'no-ean' }
  | { kind: 'no-match' };

/**
 * Request body for `POST /listings/connections/:connectionId/categories/resolve-batch`
 * (#795). One result entry per item, keyed by `variantId`. `sourceCategoryIds`
 * (#1522) enables the configured-mapping fallback when the EAN yields no match.
 */
export interface ResolveCategoriesBatchRequest {
  items: Array<{ variantId: string; ean: string | null; sourceCategoryIds?: string[] }>;
}

/** Response from the batch resolve route (#795). Keyed by `variantId`. */
export interface ResolveCategoriesBatchResponse {
  results: Record<string, EanMatchResult>;
}
