/**
 * Return Repository Port
 *
 * Persistence contract for the return aggregate (#2327, ADR-060).
 *
 * Deliberately THIN. There is still no transition, no counter write and no
 * restock. #2328 widened it with exactly one method — {@link
 * ReturnRepositoryPort.upsertFromSource}, the idempotent update-or-create keyed
 * `(sourceConnectionId, externalReturnId)` that `findByExternalId` and the
 * partial unique index were shipped for. #2330 added the two READ halves of the
 * lifecycle sweep ({@link ReturnRepositoryPort.findForSourceSweep} / {@link
 * ReturnRepositoryPort.countForSourceSweep}) — reads only; the sweep writes
 * through `upsertFromSource` like every other ingestion path. Decline belongs
 * to #2333, the read API to #2334. Each of those widens this port rather than
 * inventing a second one.
 *
 * **A note for #2333 and everything after it: `orders` must never import
 * `returns` back.** The edge runs one way — `returns -> orders`, and today only
 * for `RefundReason` off the `@openlinker/core/orders/types` cycle-breaker
 * sub-barrel. A return-shaped read added to an orders service would close a CJS
 * module-load cycle; it belongs on this context's own service (#2328) instead.
 *
 * @module domain/ports
 */
import type { ReturnRecord } from '../entities/return-record.entity';
import type { ReturnLine } from '../entities/return-line.entity';
import type { ReturnLineEvent } from '../entities/return-line-event.entity';
import type { ReturnCustodyOutcome } from '../domain-services/return-custody-transitions.domain-service';
import type {
  CreateReturnLineEventInput,
  SettleReturnLineEventInput,
} from '../types/return-line-event.types';
import type { CreateReturnRecordInput } from '../types/return.types';
import type { UpsertReturnRecordInput, UpsertReturnResult } from '../types/return-upsert.types';
import type {
  ReturnSourceSweepFilter,
  ReturnSweepCandidate,
} from '../types/return-sweep.types';
import type { ReturnReattributionCandidate } from '../types/return-reattribution.types';
import type { ReturnBucketCounts, ReturnListFilter } from '../types/return-query.types';

export interface ReturnRepositoryPort {
  /**
   * Persist one return header and its lines in a single transaction — a header
   * without its lines is not a return, so a partial write must not be
   * observable.
   */
  create(input: CreateReturnRecordInput): Promise<ReturnRecord>;

  /** Hydrates the aggregate with its lines, ordered by `lineIndex`. */
  findById(id: string): Promise<ReturnRecord | null>;

  /**
   * The source-keyed lookup #2328's update-or-create needs.
   *
   * `externalReturnId` is non-nullable HERE even though the column is nullable:
   * a NULL external id identifies nothing, so "find the return with no external
   * id on this connection" would match an arbitrary member of a set. #2328's
   * gate RESOLVED the open question this docblock used to carry: an id-less
   * source IS given a synthetic key, minted ADAPTER-side — see
   * {@link ReturnRepositoryPort.upsertFromSource}.
   */
  findByExternalId(
    sourceConnectionId: string,
    externalReturnId: string
  ): Promise<ReturnRecord | null>;

  /**
   * The idempotent update-or-create ingestion writes through (#2328).
   *
   * Header and lines in ONE transaction, one statement per table — a re-sync of
   * the same return converges on the same rows rather than accumulating
   * duplicates.
   *
   * ## The key, and why the adapter must synthesise one
   *
   * The conflict target is the PARTIAL index
   * `("sourceConnectionId", "externalReturnId") WHERE "externalReturnId" IS NOT
   * NULL`, so the statement carries that predicate too — a bare conflict target
   * does not match a partial index. NULLs are distinct under it by design (an
   * id-less source must be able to hold many returns), which is exactly why a
   * NULL key has no conflict target and would duplicate unboundedly. Core
   * therefore REFUSES a null/blank key rather than writing one, and a source
   * that mints no return id (Erli) is given a **synthetic** key by its ADAPTER.
   *
   * That synthetic key MUST be:
   *  - **deterministic** — the same observation yields byte-identical bytes on
   *    every re-sync, or idempotency is lost and the duplication returns;
   *  - **built only from source-stable coordinates** — never a timestamp, a
   *    random value, a page offset or anything that moves between syncs;
   *  - **namespaced** by the source so two sources cannot collide on one
   *    connection. The recorded Erli form is
   *    `erli:{externalOrderId}:{index}`. Its known weakness is accepted and
   *    named: if the source reorders its return array, the positional index
   *    moves and OL sees a different return. No stabler coordinate exists in
   *    that payload, and the alternative — no key at all — is strictly worse.
   *
   * ## What this write may and may not touch
   *
   * Source-owned fields are refreshed verbatim (latest-wins). `openedAt` and
   * `internalOrderId` are applied with COALESCE, so a later write may fill them
   * in but never blank them back out — attribution is MONOTONIC, and a failed
   * re-resolve must not re-orphan a return that was already attributed.
   * `origin` and `sourceConnectionId` are insert-only. The OL-owned timestamps
   * `authorizedAt` / `declinedAt` / `closedAt` and every Wave-2 line column
   * (the counters beyond `quantityAdvised`, custody, money, disposition,
   * `receivedAt`, `disposedAt`, `resolvedOrderLineId`) appear in NEITHER half —
   * see the implementation's enumeration docblock.
   *
   * A line the source stops reporting is LEFT IN PLACE, not deleted: deleting
   * would erase the record of a parcel that may already be in the building.
   *
   * The returned record reports the three OL-owned timestamps as `null`
   * whatever the row holds, because the statement did not write them; a caller
   * needing their true value re-reads via {@link ReturnRepositoryPort.findById}.
   */
  upsertFromSource(input: UpsertReturnRecordInput): Promise<UpsertReturnResult>;

  /**
   * The operator's orphan bucket: returns OL could not attribute to an order,
   * newest first. Backed by the partial index
   * `IDX_returns_orphans (createdAt DESC) WHERE "internalOrderId" IS NULL`,
   * which is this exact query. Headers only — the bucket is a triage list, and
   * hydrating every line for it would be N+1 for data the list does not render.
   */
  listOrphans(limit: number, offset: number): Promise<ReturnRecord[]>;

  /**
   * How many returns are orphaned right now — the operator's attention number (#2332).
   *
   * The same `internalOrderId IS NULL` predicate {@link ReturnRepositoryPort.listOrphans}
   * uses, over the same `IDX_returns_orphans` partial index, because it is the same
   * question asked for a count instead of a page. Deliberately NOT connection-scoped:
   * `listOrphans` is connection-agnostic, and a deployment-wide attention number is what
   * the bucket is for; a per-connection breakdown is additive later if a surface needs
   * one.
   */
  countOrphans(): Promise<number>;

  /**
   * One page of orphans worth re-checking against `identifier_mappings` (#2332).
   *
   * Filtered to orphans on ONE connection that still carry a source order reference —
   * see {@link ReturnReattributionCandidate} for why a NULL `externalOrderId` is excluded
   * rather than scanned forever. Headers projection only; the pass renders nothing.
   *
   * Ordered `createdAt DESC, id ASC`. **Note this is the OPPOSITE direction to
   * {@link ReturnRepositoryPort.findForSourceSweep}, which is oldest-first, and the
   * difference is deliberate rather than an oversight in one of them**: that sweep asks
   * "which return has been open longest without a re-read", so oldest-first is fairest;
   * this one asks "whose order is most likely to have just arrived", and that is the
   * RECENT orphan — an orphan from six months ago is one whose order was probably never
   * going to be ingested at all. The `id ASC` tiebreak keeps the scan offset meaning the
   * same thing between runs either way.
   */
  findOrphansForReattribution(
    sourceConnectionId: string,
    limit: number,
    offset: number
  ): Promise<ReturnReattributionCandidate[]>;

  /**
   * How many rows match the same candidate filter — the total a scan offset wraps
   * against. Separate from the page read for the reason
   * {@link ReturnRepositoryPort.countForSourceSweep} is, and built from the same shared
   * private query so the page and the total can never diverge.
   */
  countOrphansForReattribution(sourceConnectionId: string): Promise<number>;

  /**
   * Attribute an orphan to an order — a CONDITIONAL update, answering whether it won.
   *
   * `WHERE "id" = $1 AND "internalOrderId" IS NULL`, reporting `affected > 0` (the
   * `ShipmentRepository.claimWaybillRelay` shape, #1947). The `IS NULL` arm does two
   * jobs. It serialises this pass against a concurrent `upsertFromSource` that may be
   * filling the same column — the loser learns it lost rather than overwriting. And it
   * is what keeps attribution **monotonic**: this method can only ever fill the value in,
   * never change one, so no reconcile can re-point a return at a different order.
   *
   * A `false` return is therefore a SUCCESS from the operator's point of view (the
   * return is attributed, just not by this call) and the pass counts it
   * `alreadyAttributed`, never `unresolved` and never `failed`.
   */
  claimAttribution(id: string, internalOrderId: string): Promise<boolean>;

  /**
   * One page of returns worth re-reading at the source (#2330, pass 2).
   *
   * Headers-projection only — the sweep re-reads each candidate by its
   * source-native id and never renders a line, so hydrating lines here would be
   * an N+1 for data nothing consumes.
   *
   * Ordered `openedAt ASC, id ASC` — deterministic, so a rolling scan offset
   * means the same thing between runs, and oldest-first so the returns that
   * have been open longest are re-checked first.
   *
   * See {@link ReturnSourceSweepFilter} for why each of its three filters is
   * load-bearing; in particular the age bound is NOT optional.
   */
  findForSourceSweep(
    filter: ReturnSourceSweepFilter,
    limit: number,
    offset: number
  ): Promise<ReturnSweepCandidate[]>;

  /**
   * How many rows match the same filter — the total a scan offset wraps
   * against.
   *
   * Separate from {@link ReturnRepositoryPort.findForSourceSweep} rather than
   * returned alongside it because the count is a full scan of the filtered set
   * while the page is a bounded read; the offer- and shipment-status sweeps
   * draw the same line. A caller composes the two into a
   * `ReturnSourceSweepPage`.
   */
  countForSourceSweep(filter: ReturnSourceSweepFilter): Promise<number>;

  /**
   * Stamp `declinedAt` at most once, from an OBSERVED source confirmation
   * (#2333).
   *
   * Conditional on `"declinedAt" IS NULL` — the `claimWaybillRelay` shape —
   * which is what makes the decline action's double-call safety a database
   * property rather than a service convention, and what serializes the two
   * triggers that can reach it (an operator's action, and a future reconciler
   * stamping from a feed observation). Reports `affected > 0`.
   *
   * **Claim-only; there is no release.** Unlike the waybill relay, a decline is
   * not re-driven: once the source has told OL the return is declined, that fact
   * does not become untrue.
   *
   * The caller MUST pass the SOURCE's own instant. Core never substitutes its
   * own clock here — see `ReturnDeclineResult.declinedAt`.
   */
  claimDeclinedAt(id: string, at: Date): Promise<boolean>;

  /**
   * One page of the operator's returns list (#2334) — the general read behind
   * `GET /returns`.
   *
   * **Headers only**, for the reason {@link ReturnRepositoryPort.listOrphans}
   * gives: a list renders no lines, so hydrating them would be an N+1 for data
   * nothing shows. A caller that needs lines has the id and calls
   * {@link ReturnRepositoryPort.findById}.
   *
   * Ordered `createdAt DESC, id ASC` — newest first because a returns list is a
   * triage surface, and the `id ASC` tiebreak so a limit/offset page means the
   * same thing between two requests that straddle a same-millisecond insert.
   *
   * This does **not** replace `listOrphans`. That method is the same question
   * asked with `bucket: 'orphan'` and no other filter, and it stays because it
   * is the narrower read, has its own consumers, and rides
   * `IDX_returns_orphans` unconditionally.
   *
   * **Index coverage, stated plainly because the enumeration would otherwise
   * imply more than is true.** With `sourceConnectionId` present this rides
   * `IDX_returns_connection_created (sourceConnectionId, createdAt)`. With
   * `bucket: 'orphan'` and nothing else it can ride `IDX_returns_orphans`. But
   * the **unfiltered call — which is the frontend's default page load — rides
   * NO index**: it is `ORDER BY "createdAt" DESC` with no predicate, and there
   * is no index on `createdAt` alone. That is accepted for Wave 1c rather than
   * papered over: returns arrive at a fraction of order volume, and adding a
   * `(createdAt DESC)` index is a purely additive follow-up whose migration
   * this read-only slice deliberately does not carry. If the default list ever
   * shows up in a slow-query log, that index is the fix — not a redesign here.
   *
   * See {@link ReturnListFilter} for the rule that an absent filter field adds
   * no arm.
   */
  listReturns(
    filter: ReturnListFilter,
    limit: number,
    offset: number
  ): Promise<ReturnRecord[]>;

  /**
   * The attribution partition over the same filter scope (#2334).
   *
   * ONE query, using a `FILTER (WHERE "internalOrderId" IS NULL)` aggregate, so
   * `total` and `orphan` come from the same scan and cannot disagree under a
   * concurrent write; `attributed` is the subtraction. Two separate `count`s
   * would be two scans AND a way for the chip row to stop adding up.
   *
   * A count over a filtered set is a full scan of that set by nature — the same
   * trade {@link ReturnRepositoryPort.countOrphans} and
   * {@link ReturnRepositoryPort.countForSourceSweep} already make. Stated
   * rather than silently accepted: on a very large `returns` table this is the
   * expensive half of the list request, and the connection-scoped call (the
   * common one) is index-served while the unscoped one is not.
   *
   * The caller passes the filter **with `bucket` already removed** — see
   * {@link ReturnBucketCounts} for why the counts must not be narrowed by the
   * bucket being displayed. This method does not strip it defensively: a filter
   * that arrives carrying a bucket is a caller bug, and silently ignoring a
   * field would make the two reads disagree about what the filter means.
   */
  countReturnsByBucket(filter: ReturnListFilter): Promise<ReturnBucketCounts>;

  /**
   * One line plus its parent return, WITHOUT a row lock (#2370).
   *
   * For reads that write nothing and for the validation pass the dispose path
   * runs before it crosses the inventory-master boundary. Every write path uses
   * {@link ReturnRepositoryPort.runLineWrite} instead, which locks.
   */
  findLine(lineId: string): Promise<{ line: ReturnLine; record: ReturnRecord } | null>;

  /**
   * Run a custody write against a line held under `SELECT … FOR UPDATE` (#2370).
   *
   * **The lock is the point, and the DB CHECK cannot replace it.** Every custody
   * transition computes `quantityReceived + n` from a value read beforehand, so
   * two concurrent receipts of 3 against `advised: 5` both read 0, both compute
   * 3, and the second write wins — the line records 3, not 6.
   * `CHK_return_lines_quantity_ordering` is silent, because `3 <= 5` is legal:
   * the constraint guarantees no IMPOSSIBLE line is persisted, never that no
   * update is lost. So the read and the write happen inside one transaction with
   * the row locked, and the callback receives the locked state.
   *
   * The callback returns the act to append and, optionally, the custody outcome
   * to apply — optional because a blocked restock IS a disposition that must be
   * recorded while its counters must NOT move (spec § 5.4: the units stay in
   * `quantityReceived`, and the attestation is what later moves them).
   */
  runLineWrite<T>(
    lineId: string,
    /**
     * Decides the write from the LOCKED row. May be synchronous — the decision
     * is a pure transition over state the repository has already read, so
     * nothing inside it needs to await; the implementation awaits the result
     * either way, so an async callback stays legal for a future caller that
     * genuinely needs one.
     */
    write: (locked: { line: ReturnLine; record: ReturnRecord }) =>
      | ReturnLineWriteDecision<T>
      | Promise<ReturnLineWriteDecision<T>>
  ): Promise<{ event: ReturnLineEvent; result: T }>;

  /**
   * Settle an already-persisted act once the master has answered (#2370).
   *
   * Split from the append because the act is written BEFORE the adapter call —
   * the ADR-056 attempted-predicate ordering — so that a process dying mid-call
   * leaves an `in_doubt` row rather than silence. This is the second half.
   *
   * Takes an OPTIONAL custody outcome for the same reason
   * {@link ReturnRepositoryPort.runLineWrite} does: a success moves the
   * counters, a block does not, and both settle the same act.
   */
  settleLineRestock(
    eventId: string,
    lineId: string,
    patch: SettleReturnLineEventInput,
    /**
     * Computes the custody move from the row as it stands under the lock, or
     * returns `null` to settle the act WITHOUT moving any counter (the blocked
     * branch, spec § 5.4).
     *
     * **A callback rather than a precomputed outcome, and that is the whole
     * point.** A `ReturnCustodyOutcome` carries ABSOLUTE counter values, so one
     * computed from an unlocked read before the master call would write a stale
     * `quantityReceived` back — silently clobbering a `receiveLine` that landed
     * in the meantime. The per-line distributed lock does not cover that case,
     * because receiving takes no lock (it crosses no boundary), so the read and
     * the write have to be inside one locked transaction.
     */
    computeOutcome: (line: ReturnLine) => ReturnCustodyOutcome | null,
    disposition: ReturnLine['disposition']
  ): Promise<ReturnLineEvent>;

  /**
   * Every act on a line whose master write is still unresolved — `blocked` or
   * `in_doubt` (#2370).
   *
   * The attestation's input set, and the derivation behind the operator-facing
   * block flag. Spec § 5.4 requires the badge and its segment to count
   * UNHANDLED blocks only, so this predicate — not "has ever been blocked" — is
   * the one both read through. Rides
   * `IDX_return_line_events_outstanding_restock`.
   */
  findOutstandingRestockEvents(lineId: string): Promise<ReturnLineEvent[]>;

  /**
   * The same question asked of a whole return, for the read surfaces #2376 and
   * #2381 render. One indexed lookup rather than a fan-out over its lines.
   */
  findOutstandingRestockEventsForReturn(returnId: string): Promise<ReturnLineEvent[]>;

  /**
   * Every act on a line, oldest first — the audit narrative #2376's timeline
   * renders, and the proof-of-work a spec sums against the counters.
   */
  listLineEvents(lineId: string): Promise<ReturnLineEvent[]>;
}

/**
 * What a {@link ReturnRepositoryPort.runLineWrite} callback decides: the act to
 * append, and — optionally — the custody move to apply alongside it.
 *
 * `outcome` is nullable because a BLOCKED restock is a disposition that must be
 * recorded while its counters must NOT move: the goods really were disposed of,
 * but the inventory master's book did not take them, so the units stay counted
 * in `quantityReceived` until an operator attests (returns spec § 5.4).
 */
export interface ReturnLineWriteDecision<T> {
  event: CreateReturnLineEventInput;
  outcome: ReturnCustodyOutcome | null;
  /** Written onto `return_lines.disposition` when the outcome applies. */
  disposition: ReturnLine['disposition'];
  result: T;
}
