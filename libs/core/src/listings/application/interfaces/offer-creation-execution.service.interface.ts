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

import type { OfferCreationRecord } from '../../domain/entities/offer-creation-record.entity';
import type {
  ExecuteOfferCreationInput,
  ExecuteOfferCreationResult,
} from '../types/offer-creation-execution.types';

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

  /**
   * Settle a record whose creation job died (#3505, G01-2): nothing will run
   * the create again, so a record still `pending` moves to `failed` with an
   * error saying so — and that the marketplace MAY already have the offer,
   * since a job that died on an ambiguous write cannot tell.
   *
   * Conditional: a record already past `pending` is left exactly as it is.
   * Resolves with the record when it was moved, `null` when it was not.
   */
  abandonCreation(recordId: string, reason: string): Promise<OfferCreationRecord | null>;
}
