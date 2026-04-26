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
