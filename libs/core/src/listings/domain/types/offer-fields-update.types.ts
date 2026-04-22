/**
 * Offer Fields Update Types
 *
 * Command type for full offer field updates (price, title, description) via
 * `OfferManagerPort.updateOfferFields`. Distinct from quantity-only updates in
 * `offer-quantity-update.types.ts`.
 *
 * @module libs/core/src/listings/domain/types
 */

import type { OfferFieldUpdate } from './offer-update.types';

export interface UpdateOfferFieldsCommand {
  /** Marketplace-native (external) offer ID. */
  externalOfferId: string;
  /** Partial field update — at least one field must be set. */
  fields: OfferFieldUpdate;
  /** Optional idempotency key for deduplication. */
  idempotencyKey?: string;
}
