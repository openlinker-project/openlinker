/**
 * Product Publish Execution Types
 *
 * Input/result contract for `IProductPublishExecutionService.executePublish`,
 * the core orchestration step of an OL → shop product publish (#1042).
 *
 * @module libs/core/src/listings/application/types
 */

import type { PublishProductContent, PublishProductStatus } from '@openlinker/core/listings';
import type { JobOutcome } from '@openlinker/core/sync';

import type { ListingCreationRecord } from '../../domain/entities/listing-creation-record.entity';

export interface ExecutePublishProductInput {
  /** OL internal variant id being published. */
  internalVariantId: string;
  /** Target shop connection id. */
  connectionId: string;
  /** Stock quantity to expose on the shop. */
  stock: number;
  /** Target publication state (`draft` | `published`). */
  status: PublishProductStatus;
  /** Optional caller-supplied price; when omitted, builder falls back to master product. */
  price?: { amount: number; currency: string };
  /** Optional owned-record content overrides. */
  content?: PublishProductContent;
  /** Optional idempotency key threaded to the adapter. */
  idempotencyKey?: string;
  /**
   * Existing ListingCreationRecord id to update, if the caller pre-created one.
   * When absent, the service creates a fresh record with status='pending'.
   */
  listingCreationRecordId?: string;
}

export interface ExecutePublishProductResult {
  /** Terminal-state record after the flow finishes (success or recorded failure). */
  listingCreationRecord: ListingCreationRecord;
  /**
   * Business outcome:
   * - `'ok'` when the record landed in `published` / `draft`,
   * - `'business_failure'` when the record landed in `failed` (builder
   *   validation, master-catalog misconfig, shop rejection).
   *
   * Threaded back through the worker handler to `SyncJobRunner`
   * (`sync_jobs.outcome`).
   */
  outcome: JobOutcome;
}
