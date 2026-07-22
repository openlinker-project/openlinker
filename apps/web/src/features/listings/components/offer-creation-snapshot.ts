/**
 * Offer-creation snapshot readability guard
 *
 * A persisted `OfferCreationRecord.request` snapshot may be written by a
 * server newer than this client. `OfferCreationTracker` uses this guard to
 * decide whether its Retry affordance can safely re-open the snapshot: a
 * version it does not recognise must not be mapped with stale semantics.
 *
 * (The single-offer form-value mapper that previously lived here was retired
 * with the single-offer wizards in #1754; the unified bulk retry re-seeds the
 * wizard from URL params, not from the snapshot shape.)
 *
 * @module apps/web/src/features/listings/components
 */
import {
  SUPPORTED_OFFER_CREATION_REQUEST_SCHEMA_VERSION,
  type CreateOfferRequest,
} from '../api/listings.types';

/**
 * Guard against reading a snapshot persisted by a server newer than the
 * client. `undefined` is tolerated for records persisted before the
 * schema version field landed - those are structurally identical to v1
 * so the mapping is safe.
 */
export function canReadCreateOfferRequestSnapshot(request: CreateOfferRequest): boolean {
  const version = request.schemaVersion;
  return version === undefined || version === SUPPORTED_OFFER_CREATION_REQUEST_SCHEMA_VERSION;
}
