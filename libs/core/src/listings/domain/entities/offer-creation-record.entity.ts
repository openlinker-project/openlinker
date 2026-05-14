/**
 * Offer Creation Record Domain Entity
 *
 * Tracks the lifecycle of an OL-initiated offer creation on a marketplace
 * (OL → Allegro / WooCommerce / eBay / etc.). Complements the existing
 * IdentifierMapping row (`entityType: 'Offer'`) which tracks the linkage once
 * the offer exists — this record tracks the *creation attempt* itself, including
 * pending state before the adapter is called, structured validation errors when
 * the platform rejects it, and the externalOfferId handoff.
 *
 * @module libs/core/src/listings/domain/entities
 */

import type { OfferCreationError, OfferCreationStatus } from '../types/offer-creation-record.types';
import type { OfferCreationRequestSnapshot } from '../types/offer-creation-request-snapshot.types';

export class OfferCreationRecord {
  constructor(
    public readonly id: string,
    public readonly internalVariantId: string,
    public readonly connectionId: string,
    public readonly externalOfferId: string | null,
    public readonly status: OfferCreationStatus,
    public readonly errors: OfferCreationError[] | null,
    public readonly publishImmediately: boolean,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    /**
     * Persisted snapshot of the original create-offer request. Null for records
     * predating this change and for records created through code paths that do
     * not pass the snapshot. Surfaced on the status response for retry
     * pre-fill on the wizard.
     */
    public readonly request: OfferCreationRequestSnapshot | null = null
  ) {}
}
