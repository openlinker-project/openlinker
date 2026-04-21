/**
 * Offer Creation Enqueue Service Interface
 *
 * Contract for the pre-enqueue half of the OL → marketplace offer creation
 * flow. Mirrors `IOfferCreationExecutionService` (post-enqueue) so the HTTP
 * endpoint and any future trigger (webhook, automation, batch) share one
 * orchestration point.
 *
 * Responsibilities:
 *   1. Resolve the Marketplace adapter for the connection (validates
 *      connection existence, status, and capability support).
 *   2. Verify the adapter implements `createOffer` — Marketplace is
 *      supported, but not every marketplace adapter offers outbound create.
 *   3. Create an `OfferCreationRecord` with status='pending' so the record
 *      is visible before the worker picks up the job.
 *   4. Enqueue the `marketplace.offer.create` job carrying the record id.
 *
 * Per `architecture-overview.md` §6, sync orchestration policies live in
 * core application services — not in controllers, not in worker handlers.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type {
  EnqueueOfferCreationInput,
  EnqueueOfferCreationResult,
} from '../types/offer-creation-enqueue.types';

export interface IOfferCreationEnqueueService {
  /**
   * Validate + pre-create record + enqueue job.
   *
   * Throws:
   * - `ConnectionNotFoundException` (→ HTTP 404) when the connection does not exist.
   * - `ConnectionDisabledException` (→ HTTP 409) when the connection is disabled.
   * - `CapabilityNotSupportedException` (→ HTTP 422) when the connection's
   *   adapter does not implement the `Marketplace` capability at all.
   * - `UnprocessableEntityException` (→ HTTP 422) when the adapter supports
   *   `Marketplace` but does not implement `createOffer`.
   *
   * The connection-resolution exceptions come from `IIntegrationsService`
   * and are expected to propagate to the controller layer unchanged.
   */
  enqueueCreation(input: EnqueueOfferCreationInput): Promise<EnqueueOfferCreationResult>;
}
