/**
 * Offer Creation Execution Types
 *
 * Input/result contract for `IOfferCreationExecutionService.executeCreation`,
 * the core orchestration step of an OL → marketplace offer creation.
 *
 * @module libs/core/src/listings/application/types
 */

import type { CreateOfferOverrides } from '@openlinker/core/listings';
import type { JobOutcome } from '@openlinker/core/sync';

import type { OfferCreationRecord } from '../../domain/entities/offer-creation-record.entity';

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
  /**
   * Business outcome of the creation:
   * - `'ok'` when the record landed in `active` / `draft` / `validating`,
   * - `'business_failure'` when the record landed in `failed` (builder
   *   validation, master-catalog misconfig, marketplace rejection).
   *
   * Threaded back through the worker handler to `SyncJobRunner`, which
   * persists it on `sync_jobs.outcome`. See issue #400 (Plan B for #391).
   */
  outcome: JobOutcome;
}
