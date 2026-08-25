/**
 * Returns Service Interface
 *
 * The `returns` context's application contract (#2328, ADR-060).
 *
 * This is the seam a sibling context reaches the aggregate through. It exists
 * partly so that `RETURN_REPOSITORY_TOKEN` never has to leave this context: a
 * cross-context caller goes through `I*Service`, never a `*RepositoryPort`
 * (`docs/architecture-overview.md § Cross-context dependencies in core`) — and
 * in this context's case that rule has teeth, because a return-shaped read
 * added to an `orders` service would close a CJS module-load cycle.
 *
 * @module libs/core/src/returns/application/services
 */
import type { ReturnRecord } from '../../domain/entities/return-record.entity';
import type { IncomingReturn } from '../../domain/types/incoming-return.types';

/**
 * What one ingested observation did.
 *
 * `attributed` reports whether OL could name the order this return belongs to.
 * It is a per-call OBSERVATION, not a stored flag: a return already attributed
 * by an earlier write stays attributed even when this call could not resolve
 * the order (attribution is monotonic in the database), so a caller reading
 * `attributed: false` learns "this call did not resolve it", never "this return
 * is an orphan". The row itself is the authority; re-read it if that is the
 * question.
 *
 * **There is no `created` flag** — see `UpsertReturnResult` for why the insert/
 * update distinction is deliberately not reported.
 */
export interface UpsertReturnObservationResult {
  record: ReturnRecord;
  attributed: boolean;
}

export interface IReturnsService {
  /**
   * Ingest one source observation, idempotently.
   *
   * Maps the neutral `IncomingReturn` projection (#2329) onto the OL-owned
   * aggregate and writes it through the repository's update-or-create. Safe to
   * call repeatedly with the same observation: a replay converges on one row.
   *
   * Throws `ReturnObservationMissingExternalIdError` when the observation
   * carries no usable key — non-retryable, and the caller's correct response is
   * to skip the ITEM and continue the page.
   */
  upsertFromObservation(
    sourceConnectionId: string,
    observation: IncomingReturn
  ): Promise<UpsertReturnObservationResult>;

  /** Hydrated aggregate, lines included and ordered by `lineIndex`. */
  getReturn(id: string): Promise<ReturnRecord | null>;

  /**
   * The operator's orphan bucket — returns OL could not attribute to an order,
   * newest first. Headers only; the triage list does not render lines.
   */
  listOrphanReturns(limit: number, offset: number): Promise<ReturnRecord[]>;
}
