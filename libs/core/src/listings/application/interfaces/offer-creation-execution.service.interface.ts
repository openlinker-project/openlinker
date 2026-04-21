/**
 * Offer Creation Execution Service Interface
 *
 * Contract for the core orchestration step that turns an OL internal variant
 * plus caller overrides into a live marketplace offer (outbound, OL → Allegro
 * / WooCommerce / eBay). Used by the `marketplace.offer.create` worker handler
 * and the future REST endpoint (#259) so both paths share identical semantics.
 *
 * Per `architecture-overview.md` §6, orchestration policies live in core
 * application services rather than worker handlers.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type {
  ExecuteOfferCreationInput,
  ExecuteOfferCreationResult,
} from '../../domain/types/offer-creation-execution.types';

export interface IOfferCreationExecutionService {
  /**
   * Execute the full create-offer flow: resolve variant and marketplace,
   * build the neutral command, invoke the adapter, persist the
   * OfferCreationRecord + IdentifierMapping.
   *
   * Terminal domain failures (builder validation, master-catalog misconfig,
   * platform reject) are caught and persisted to the record as `status='failed'`
   * with structured errors — the method resolves normally in those cases so
   * the calling worker job isn't retried.
   *
   * Transient / unknown errors propagate to the caller so the worker runner
   * can schedule a retry.
   */
  executeCreation(input: ExecuteOfferCreationInput): Promise<ExecuteOfferCreationResult>;
}
