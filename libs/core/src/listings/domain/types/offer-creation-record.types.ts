/**
 * Offer Creation Record Types
 *
 * Types for OfferCreationRecord — OL's persisted lifecycle tracker for offers
 * created outbound on a marketplace (OL → Allegro / WooCommerce / eBay / etc.).
 *
 * Not to be confused with `CreateOfferResultStatus` from
 * `listings/domain/types/offer-create.types.ts`, which is the
 * momentary status returned by the adapter right after the platform API call.
 * `OfferCreationStatus` is the broader persisted lifecycle, including `pending`
 * (before the adapter was called) and `failed` (post-validation failure).
 *
 * @module libs/core/src/listings/domain/types
 */

import type { OfferCreationRequestSnapshot } from './offer-creation-request-snapshot.types';

/**
 * Persisted lifecycle status for OL-initiated offer creation.
 *
 * - `pending`: Job enqueued, adapter not yet called.
 * - `draft`: Adapter created the offer on the platform; not yet published.
 * - `validating`: Platform is asynchronously validating (Allegro pattern).
 * - `active`: Offer is published and live.
 * - `failed`: Creation or async validation failed. See `errors` on the record.
 */
export const OfferCreationStatusValues = [
  'pending',
  'draft',
  'validating',
  'active',
  'failed',
] as const;

export type OfferCreationStatus = (typeof OfferCreationStatusValues)[number];

/**
 * Named-constant map for the offer-creation lifecycle status (#668).
 *
 * Lets call sites reference status values by name
 * (`OFFER_CREATION_STATUS.Pending`) rather than repeating bare
 * `'pending'` / `'failed'` literals. The `as const satisfies` keeps the map
 * in lockstep with the union on *both* axes — drop an entry → TS errors
 * because the key domain is `Capitalize<OfferCreationStatus>` (e.g. drop
 * `Pending` and the satisfies check fails); type a value to a non-member
 * literal → TS errors because the value domain is `OfferCreationStatus`.
 */
export const OFFER_CREATION_STATUS = {
  Pending: 'pending',
  Draft: 'draft',
  Validating: 'validating',
  Active: 'active',
  Failed: 'failed',
} as const satisfies Record<Capitalize<OfferCreationStatus>, OfferCreationStatus>;

/**
 * Structured error from the platform (or validation path).
 * Persisted in `OfferCreationRecord.errors` when status is `failed`.
 */
export interface OfferCreationError {
  /** Dotted field path reported by the platform, when available (e.g. `parameters.EAN`). */
  field?: string;
  /** Machine-readable error code (platform-specific or OL-defined). */
  code: string;
  /** Human-readable message suitable for showing an operator. */
  message: string;
}

/**
 * Input contract for `OfferCreationRecordRepositoryPort.create`.
 *
 * Dedicated input type (not `Omit<OfferCreationRecord, ...>`) so the write
 * contract is decoupled from the entity's readonly shape and future entity
 * changes (added fields, derived behavior) don't silently affect callers.
 */
export interface CreateOfferCreationRecordInput {
  /** OL internal variant id being listed. */
  internalVariantId: string;
  /** Target marketplace connection id. */
  connectionId: string;
  /** Initial lifecycle status — typically `'pending'` or `'draft'`. */
  status: OfferCreationStatus;
  /** Intent flag: if true, the creator wants the offer published immediately once valid. */
  publishImmediately: boolean;
  /** Marketplace-native offer id, if already known at creation time. Null otherwise. */
  externalOfferId?: string | null;
  /** Structured errors when the initial status is already `'failed'`. Null otherwise. */
  errors?: OfferCreationError[] | null;
  /**
   * Persisted snapshot of the original create-offer request payload. Enables
   * retry pre-fill on the wizard when a record is `'failed'`. Omitted or
   * `null` for callers that cannot or do not need to supply it; readers must
   * tolerate null.
   */
  request?: OfferCreationRequestSnapshot | null;
  /**
   * Parent BulkOfferCreationBatch id for records created via the bulk
   * submission flow (#736). Omitted or `null` for single-offer creates.
   */
  bulkBatchId?: string | null;
}
