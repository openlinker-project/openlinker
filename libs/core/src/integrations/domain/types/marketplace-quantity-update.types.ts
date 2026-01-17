/**
 * Marketplace Offer Quantity Update Types
 *
 * Canonical command and result types for updating offer quantity on a marketplace.
 *
 * Domain-only: no framework dependencies.
 *
 * @module libs/core/src/integrations/domain/types
 */

/**
 * Command to update a single offer quantity.
 */
export interface UpdateOfferQuantityCommand {
  offerId: string;
  quantity: number;

  /**
   * Optional idempotency key. If absent, core orchestration should generate one deterministically.
   */
  idempotencyKey?: string;
}

/**
 * Batch command for updating multiple offer quantities.
 */
export interface UpdateOfferQuantitiesBatchCommand {
  items: UpdateOfferQuantityCommand[];

  /**
   * Optional batch-level idempotency key.
   */
  idempotencyKey?: string;
}

export interface UpdateOfferQuantitiesBatchFailure {
  offerId: string;
  errorCode: string;
  message?: string;
}

/**
 * Result for batch quantity update, supporting partial failures.
 */
export interface UpdateOfferQuantitiesBatchResult {
  succeeded: string[]; // offerIds
  failed: UpdateOfferQuantitiesBatchFailure[];
}

