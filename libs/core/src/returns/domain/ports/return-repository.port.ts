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
import type { CreateReturnRecordInput } from '../types/return.types';
import type { UpsertReturnRecordInput, UpsertReturnResult } from '../types/return-upsert.types';
import type {
  ReturnSourceSweepFilter,
  ReturnSweepCandidate,
} from '../types/return-sweep.types';

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
}
