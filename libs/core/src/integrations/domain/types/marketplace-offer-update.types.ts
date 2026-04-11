/**
 * Marketplace Offer Update Types
 *
 * Command types for full offer field updates (price, title, description).
 * Distinct from quantity-only updates in marketplace-quantity-update.types.ts.
 *
 * @module libs/core/src/integrations/domain/types
 */

import type { OfferFieldUpdate } from '@openlinker/core/listings';

export interface UpdateOfferFieldsCommand {
  /** Marketplace-native (external) offer ID. */
  externalOfferId: string;
  /** Partial field update — at least one field must be set. */
  fields: OfferFieldUpdate;
  /** Optional idempotency key for deduplication. */
  idempotencyKey?: string;
}
