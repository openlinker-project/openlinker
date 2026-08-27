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
import type { RefundReason } from '@openlinker/core/orders/types';
import type { ReturnRecord } from '../../domain/entities/return-record.entity';
import type { IncomingReturn } from '../../domain/types/incoming-return.types';
import type { ReturnDownstreamTrigger } from '../../domain/types/return-trigger.types';
import type {
  ReturnBucketCounts,
  ReturnDeclineAvailability,
  ReturnIngestionAvailability,
  ReturnListFilter,
  ReturnStageCounts,
} from '../../domain/types/return-query.types';
import type { ReturnSegmentCounts } from '../../domain/types/return-segment.types';
import type { ReturnTimelineForOrder } from '../../domain/types/return-timeline-entry.types';

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

/**
 * One line of an operator-authored return (#2372).
 *
 * Deliberately narrower than `CreateReturnLineInput`: an operator supplies what the
 * goods ARE and how many are coming back, and nothing else. `lineIndex` is assigned
 * by position, `externalLineId` / `offerId` are source provenance a return with no
 * source cannot have, and `resolvedOrderLineId` has no populator anywhere in the
 * tree (it is a by-value reference into the order snapshot's jsonb).
 */
export interface RecordReturnLineInput {
  sku: string | null;
  name: string | null;
  reason: RefundReason;
  /** Positive whole units. Refused otherwise — see `ReturnRecordRefusedError`. */
  quantityAdvised: number;
  note: string | null;
}

/**
 * What an operator supplies to open a return in OpenLinker (#2372).
 *
 * `sourceConnectionId` is REQUIRED and is validated, not guessed: `returns`'
 * column is `uuid NOT NULL`, so the row must name a channel, and OL checks the
 * order actually maps there — which also DERIVES `externalOrderId` from the winning
 * mapping rather than accepting an operator-typed string. Deriving the connection
 * instead would pick one for the operator when the order maps on several.
 *
 * There is no `externalReturnId` field, and there must not be one: an
 * operator-authored return has no source and must never pretend to have one.
 * `UQ_returns_source_external` is partial precisely so such a row writes NULL.
 */
export interface RecordReturnInput {
  internalOrderId: string;
  sourceConnectionId: string;
  lines: RecordReturnLineInput[];
  /** The operator. Nullable so a future non-interactive writer is expressible. */
  actorUserId: string | null;
}

/** What an operator supplies to attribute an orphan return (#2372). */
export interface MatchOrphanToOrderInput {
  returnId: string;
  internalOrderId: string;
  actorUserId: string | null;
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
  listReturns(filter: ReturnListFilter, limit: number, offset: number): Promise<ReturnRecord[]>;

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
   * How many returns sit in each derived operator stage (#2377, spec § 3.2).
   *
   * The stage is a PRESENTATION PROJECTION, never a persisted column — this
   * counts a `CASE` over the counters, and the identical rule runs in the
   * browser via `deriveReturnStage`.
   *
   * Strips `stage` from the filter itself, so a caller cannot accidentally make
   * every chip report the count of the stage already selected.
   */
  countReturnsByStage(filter: ReturnListFilter): Promise<ReturnStageCounts>;

  /**
   * How many returns sit in each operator-facing segment (#2378, spec § 4.1) —
   * the returns list's worklist strip.
   *
   * Segments overlap by design, so `total` is NOT their sum. Strips `segment`
   * itself so a caller cannot make every card report the count of the segment
   * already selected.
   */
  countReturnsBySegment(filter: ReturnListFilter): Promise<ReturnSegmentCounts>;

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
  /**
   * Every return act on ONE order, oldest first (#2383) — the returns half of
   * the order-detail timeline.
   *
   * Covers the two sources this context OWNS: the custody act ledger, and the
   * `opened` / `declined` header columns. It resolves each return's source
   * connection to a display NAME, because an operator reads a channel name and
   * never an id, and a browser must not be asked to resolve one.
   *
   * **The refund entry is deliberately NOT here.** `RefundRecord` belongs to
   * `orders`, and `ReturnsModule` excludes `OrdersModule` on purpose
   * (`returns.module.ts` — it pulls in seven siblings this context has no
   * business carrying). The interface layer composes that entry in, on a module
   * that already holds the edge. Same list, one layer up.
   *
   * Returns the per-return CONTEXTS alongside the entries, covering every
   * return on the order including one that has produced no entry yet — so the
   * interface layer can compose the refund entry without defaulting a
   * `returnOrigin` it does not know. That case is reachable: `openedAt` is
   * persisted as `null` when a source reports an unparseable `createdAt`.
   *
   * Returns empty collections for an order with no returns — never throws on
   * absence.
   */
  listReturnEventsForOrder(internalOrderId: string): Promise<ReturnTimelineForOrder>;

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

  /**
   * **Attribute an ORPHAN return to an order — the operator's way out of the
   * #2332 bucket** (#2372), beside the background re-attribution reconcile.
   *
   * Unblocks every downstream trigger by construction: `assertAttributedForTrigger`
   * re-reads the row, so filling `internalOrderId` is the whole of what a refund,
   * a restock or a correction needs — no consumer changes.
   *
   * Four properties are decisions, not implementation detail.
   *
   *  1. **The order's existence is proved through `identifier_mappings`, not
   *     through `orders`.** An internal order id exists there iff OL minted it while
   *     ingesting the order, so a non-empty lookup is a sound existence proof — and
   *     it costs no `OrdersModule` edge, which this context's module docblock warns
   *     against manufacturing. It proves an id was MINTED, not that an `order_records`
   *     row still stands; that is the same by-value posture `internalOrderId` already
   *     has (there is deliberately no FK).
   *  2. **Any connection's mapping counts.** One of the documented orphan causes is
   *     an order ingested under a DIFFERENT connection, so scoping the proof to the
   *     return's own `sourceConnectionId` would refuse precisely the case this action
   *     exists for.
   *  3. **Attribution stays monotonic, and there is no unmatch.** The write is
   *     `claimAttribution`'s conditional UPDATE, so an operator can fill the value in
   *     and can never change one; a mis-match is not correctable in the product, which
   *     is why a caller should confirm before invoking this.
   *  4. **The act is recorded on the row, not in the line ledger.**
   *     `matchedAt` / `matchedByUserId` — `return_line_events` is per-LINE and its
   *     rows sum back to the counters, and a header-level attribution has neither a
   *     line nor a quantity.
   *
   * Line resolution is deliberately NOT re-run: nothing in the tree populates
   * `ReturnLine.resolvedOrderLineId`, so there is no resolution to re-run and
   * inventing one here would be a second, undesigned mapping.
   *
   * @throws {ReturnNotFoundError} the id resolves to no row.
   * @throws {ReturnMatchRefusedError} already attributed (including a lost race), or
   *   OL has never ingested the named order.
   */
  matchOrphanToOrder(input: MatchOrphanToOrderInput): Promise<ReturnRecord>;

  /**
   * **Open a return in OpenLinker against an order OL already knows** (#2372) —
   * for a source with no returns surface at all.
   *
   * The record is `origin: 'operator_authored'` with `externalReturnId: null`, and
   * `openedAt` takes OL's own clock (the operator opened it here; OL is the sensor).
   * `authorizedAt` is left NULL: recording and authorizing are two acts, which is the
   * entire premise of ADR-044/ADR-060's "authorization is an ACTION, not a state" —
   * a return that arrived pre-authorized would leave `return.authorize` with no job.
   *
   * Lines land at the schema defaults (`custodyState: 'advised'`, the #2327 money
   * default, `disposition: null`, counters at 0), which is literally what makes an
   * operator-authored return participate in custody and money exactly like an
   * ingested one.
   *
   * **Calling this twice creates two returns, and that is accepted.** There is no
   * natural key to dedup on — `externalReturnId` is NULL by design and
   * `UQ_returns_source_external` is partial — and an operator may legitimately open
   * two returns against one order. Core will not synthesise a key to prevent it: a
   * fabricated external id would make the row claim a source it does not have. A
   * caller that wants at-most-once semantics owns that above this seam.
   *
   * @throws {ReturnRecordRefusedError} no lines, a non-positive/non-integer
   *   quantity, an order OL has not ingested, or an order that does not map on the
   *   named connection.
   */
  recordReturn(input: RecordReturnInput): Promise<ReturnRecord>;
}
