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
import type { ReturnDownstreamTrigger } from '../../domain/types/return-trigger.types';
import type {
  ReturnBucketCounts,
  ReturnDeclineAvailability,
  ReturnIngestionAvailability,
  ReturnListFilter,
} from '../../domain/types/return-query.types';

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

  /**
   * How many returns are currently orphaned (#2332) — the operator's attention number,
   * deployment-wide. Pairs with {@link IReturnsService.listOrphanReturns}, which is the
   * same question asked for a page.
   */
  countOrphanReturns(): Promise<number>;

  /**
   * **The downstream-trigger block (#2332, ADR-060).** Refuse to let a Wave-2 flow act
   * on a return OL cannot attribute to an order, and hand back the aggregate when it can.
   *
   * Every downstream flow calls this — `restock`, `refund`, `invoice_correction` and the
   * `decline` write (see `ReturnDownstreamTriggerValues`) — and none writes its own orphan
   * check. Four call sites each free to spell `internalOrderId === null` are four chances
   * to forget, and a restock against a phantom order moves real stock.
   *
   * Three properties are decisions, not implementation detail:
   *
   *  1. **It RE-READS the row.** A caller's in-memory `ReturnRecord` may predate a
   *     reconcile that has since attributed it, or be an `upsertFromSource` result whose
   *     OL-owned timestamps are deliberately blanked. The row is the authority — the same
   *     rule `UpsertReturnObservationResult.attributed` already states.
   *  2. **It RETURNS the record.** A trigger needs the hydrated aggregate anyway, and
   *     making the guard the read means a caller cannot act on a different read than the
   *     one it checked.
   *  3. **It THROWS.** A boolean is ignorable; the point of the block is that a trigger
   *     cannot proceed by omission.
   *
   * @throws {ReturnNotFoundError} the id resolves to no row — a different operator
   *   situation from an orphan, and never collapsed into one.
   * @throws {ReturnNotAttributedError} the return exists and is an orphan.
   */
  assertAttributedForTrigger(
    returnId: string,
    trigger: ReturnDownstreamTrigger
  ): Promise<ReturnRecord>;

  /**
   * One page of the operator's returns list (#2334) — headers only.
   *
   * The general form of {@link IReturnsService.listOrphanReturns}, which stays
   * because it is the narrower, unconditionally index-served question and has
   * its own callers. Passing `bucket: 'orphan'` with no other filter asks the
   * same thing through this method; neither is dead.
   */
  listReturns(
    filter: ReturnListFilter,
    limit: number,
    offset: number
  ): Promise<ReturnRecord[]>;

  /**
   * The attribution partition over one filter scope (#2334) — what the
   * frontend's filter chips render.
   *
   * The caller passes the filter **with `bucket` removed**; see
   * {@link ReturnBucketCounts}. Because the partition is exhaustive, the count
   * matching a bucket-APPLIED request is already in here (`orphan` or
   * `attributed`), so a list read never needs a second count query to fill its
   * pagination total — deriving it is what keeps the total and the chips from
   * drifting apart.
   */
  countReturnsByBucket(filter: ReturnListFilter): Promise<ReturnBucketCounts>;

  /**
   * Can anything in this deployment ingest returns at all? (#2334, for #2335.)
   *
   * Exists so an empty returns list can say something true — see
   * {@link ReturnIngestionAvailability} for why "you have no returns" and
   * "nothing is configured to fetch returns" must not render identically, and
   * for the manifest-first resolution rule.
   *
   * **Throws on a discovery failure rather than reporting
   * `configured: false`.** A registry or credential problem is not evidence
   * about the operator's configuration, and answering `false` would state a
   * falsehood on the exact screen that exists to answer this question. The
   * route surfaces the failure and the frontend renders its error state.
   */
  getReturnIngestionAvailability(): Promise<ReturnIngestionAvailability>;

  /**
   * Whether `POST /returns/:id/decline` can be offered for this return, and why
   * not when it cannot (#2334, for #2336).
   *
   * Answers the two reasons that are properties of the RECORD and the
   * PLATFORM. The third reason a decline is refused — the return is an orphan —
   * is deliberately absent: that is `ReturnRecord.isOrphan()`, already on the
   * response, and a second spelling of it here would be the duplicate
   * definition the entity's docblock forbids.
   *
   * Never throws for an unresolvable adapter; see
   * {@link ReturnDeclineAvailability} for why an unknown reports `supported:
   * true` rather than disabling the action on a hiccup.
   */
  getDeclineAvailability(record: ReturnRecord): Promise<ReturnDeclineAvailability>;
}
