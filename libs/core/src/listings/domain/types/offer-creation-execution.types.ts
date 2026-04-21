/**
 * Offer Creation Execution Types
 *
 * Input/result contract for `IOfferCreationExecutionService.executeCreation`,
 * the core orchestration step of an OL → marketplace offer creation.
 *
 * Kept in the domain types folder (not application/types) so both the
 * application service and the future REST endpoint that will call it (#259)
 * can depend on these types without cyclic imports.
 *
 * @module libs/core/src/listings/domain/types
 */

import type { CreateOfferOverrides } from '@openlinker/core/integrations';

import type { OfferCreationRecord } from '../entities/offer-creation-record.entity';

export interface ExecuteOfferCreationInput {
  /** OL internal variant id being listed. */
  internalVariantId: string;
  /** Target marketplace connection id (e.g. Allegro). */
  connectionId: string;
  /** Offered stock quantity. */
  stock: number;
  /** Publish immediately after creation (marketplaces that support inline publish). */
  publishImmediately: boolean;
  /** Optional caller-supplied price; when omitted, builder falls back to master product. */
  price?: { amount: number; currency: string };
  /** Optional overrides (title, description, category, images, platformParams). */
  overrides?: CreateOfferOverrides;
  /** Optional idempotency key threaded to the adapter (e.g. Allegro external.id). */
  idempotencyKey?: string;
  /**
   * Existing OfferCreationRecord id to update, if the caller pre-created one
   * (#259 REST endpoint will do this). When absent, the service creates a
   * fresh record with status='pending'. Same downstream flow for both paths.
   */
  offerCreationRecordId?: string;
}

export interface ExecuteOfferCreationResult {
  /** Terminal-state record after the flow finishes (success or recorded failure). */
  offerCreationRecord: OfferCreationRecord;
}
