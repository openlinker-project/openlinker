/**
 * Fulfillment Work Repository Port (#2392, ADR-054, DESIGN §5.2/§6.3)
 *
 * Persistence contract for the `FulfillmentWork` aggregate.
 *
 * ## Why every mutation is a narrow conditional UPDATE
 *
 * REVIEW C10 calls `fulfillment_works` a **five-writer table** — the router
 * (#2395), the executor handshake (#2399), progress ingress (#2400), operator
 * actions (#2406/#2410) and sweeps all write it. A generic `save(work)` would
 * reproduce the `order_records` multi-writer problem at a hotter grain: a writer
 * holding a stale read silently reverts a peer's column. So there is no
 * `save`. Each method below moves ONE axis, guards on the precondition that
 * makes the move legal, and answers `boolean` — `true` = applied,
 * `false` = the precondition no longer held and **nothing was written**.
 *
 * `false` is an ordinary outcome, not an error: two writers racing is the
 * expected steady state, and the caller decides whether losing the race matters.
 * The only methods that throw are the ones where the two zero-row causes are
 * genuinely different facts an operator must tell apart (`releaseHold`).
 *
 * ## Only `create` is transaction-composable today
 *
 * The axis transitions open no transaction and accept none, so a caller cannot
 * join `cancel` or `transitionStatus` to its own unit of work. That is
 * sufficient for this slice — ADR-054 R1's requirement is about CREATING N work
 * rows alongside the order's terminalisation — but #2395 sits one transition
 * away from wanting the same seam, so the asymmetry is stated rather than left
 * to be discovered at implementation time. Widening it is #2395's call.
 *
 * ## Input shapes are objects, deliberately
 *
 * No method takes positional arguments beyond the id. #2406 will add an
 * `expectedVersion` precondition to the mutating methods; an object shape makes
 * that purely additive instead of a nine-signature widening.
 *
 * @module libs/core/src/fulfillment/domain/ports
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */
import type { FulfillmentCancellationReason } from '@openlinker/core/fulfillment-authority';
import type { HoldReason } from '@openlinker/core/order-lifecycle';

import type { FulfillmentHold } from '../types/fulfillment-hold.types';
import type { FulfillmentRequestStatus } from '../types/fulfillment-request-status.types';
import type { FulfillmentWork } from '../types/fulfillment-work.types';
import type { FulfillmentWorkRejection } from '../types/fulfillment-work-rejection.types';
import type { FulfillmentWorkStatus } from '../types/fulfillment-work-status.types';
import type {
  FulfillmentWorkListFilter,
  FulfillmentWorkPage,
} from '../types/fulfillment-worklist-page.types';

/** One line of a work object at creation time. Counters start at zero. */
export interface CreateFulfillmentWorkLineInput {
  readonly orderLineId: string;
  readonly productVariantId: string;
  readonly totalQuantity: number;
}

/**
 * An opaque handle to a transaction the CALLER owns.
 *
 * Deliberately not `EntityManager`: `engineering-standards.md § Domain Layer
 * Independence` forbids the domain layer from naming framework code, and a port
 * whose signature mentions TypeORM makes every future implementer a TypeORM
 * implementer — and an in-memory fake for #2395's tests impossible to type. The
 * repository narrows it internally; no caller inspects it.
 *
 * A structural minimum rather than `object`: `object` accepts `{}`, so passing
 * the wrong handle would fail at runtime inside `save` instead of at the call
 * site. This keeps the port framework-free AND the mistake unrepresentable.
 */
export interface FulfillmentWorkTransaction {
  readonly save: (...args: never[]) => Promise<unknown>;
}

/**
 * The router's create.
 *
 * **`locationId` and `deliveryMethod` are insert-only** — settable here and
 * moved by nothing afterwards. `status`, `requestStatus` and
 * `assignedConnectionId` are settable here too (ADR-054 R1 creates work ALREADY
 * ASSIGNED), and afterwards move ONLY through their named transitions below —
 * never through a re-save. See the repository's per-column writer table for the
 * full map; this docblock previously called all five "immutable through every
 * update path", which the three transitions in this same file contradict.
 *
 * ADR-054 R1 requires N work rows and the order's terminalisation to commit in
 * ONE transaction, which is why a caller-owned transaction may be supplied.
 */
export interface CreateFulfillmentWorkInput {
  readonly orderId: string;
  readonly locationId: string | null;
  readonly deliveryMethod: string | null;
  readonly assignedConnectionId: string | null;
  readonly status?: FulfillmentWorkStatus;
  readonly requestStatus?: FulfillmentRequestStatus;
  readonly lines: readonly CreateFulfillmentWorkLineInput[];
}

/** Move the EXECUTION axis, guarding on the status it is moving from. */
export interface TransitionFulfillmentWorkStatusInput {
  readonly workId: string;
  readonly from: readonly FulfillmentWorkStatus[];
  readonly to: FulfillmentWorkStatus;  /**
   * Optimistic-concurrency precondition (#2406). When present the conditional
   * UPDATE additionally carries `"version" = :expectedVersion`, so the state
   * predicate, the version predicate and the write are ONE statement.
   *
   * Optional, and additive by design — the port's docblock reserved exactly
   * this: *"#2406 will add an `expectedVersion` precondition to the mutating
   * methods; an object shape makes that purely additive."* Omitting it keeps
   * every pre-#2406 caller byte-identical.
   *
   * Because the version rides in the same WHERE as the state guard, a caller
   * can distinguish "somebody moved it first" (version differs) from "not legal
   * / already applied" (version matches, state guard refused) — which is what
   * honours `version`'s "counts state changes, not writes" contract instead of
   * reporting an idempotent replay as a stale-token 409.
   */
  readonly expectedVersion?: number;
}

/** Move the NEGOTIATION axis, guarding on the request status it is moving from. */
export interface TransitionFulfillmentRequestStatusInput {
  readonly workId: string;
  readonly from: readonly FulfillmentRequestStatus[];
  readonly to: FulfillmentRequestStatus;
}

/** Force-close or negotiated cancel. ADR-054 requires a reason on every one. */
/**
 * Input for `setExpedited` (#2416, spec D22).
 *
 * `expeditedAt` doubles as the DIRECTION: an instant expedites, `null`
 * releases. One field rather than a boolean plus a timestamp, so the two can
 * never disagree about what is being written.
 */
export interface SetFulfillmentWorkExpeditedInput {
  readonly workId: string;
  readonly expeditedAt: Date | null;
  /** See `CancelFulfillmentWorkInput.expectedVersion`. */
  readonly expectedVersion?: number;
}

export interface CancelFulfillmentWorkInput {
  readonly workId: string;
  readonly reason: FulfillmentCancellationReason;
  readonly cancelledAt: Date;  /**
   * Optimistic-concurrency precondition (#2406). When present the conditional
   * UPDATE additionally carries `"version" = :expectedVersion`, so the state
   * predicate, the version predicate and the write are ONE statement.
   *
   * Optional, and additive by design — the port's docblock reserved exactly
   * this: *"#2406 will add an `expectedVersion` precondition to the mutating
   * methods; an object shape makes that purely additive."* Omitting it keeps
   * every pre-#2406 caller byte-identical.
   *
   * Because the version rides in the same WHERE as the state guard, a caller
   * can distinguish "somebody moved it first" (version differs) from "not legal
   * / already applied" (version matches, state guard refused) — which is what
   * honours `version`'s "counts state changes, not writes" contract instead of
   * reporting an idempotent replay as a stale-token 409.
   */
  readonly expectedVersion?: number;
}

/** Progress ingress (#2400) moves the counters, never a per-line status. */
export interface RecordFulfillmentLineProgressInput {
  readonly workId: string;
  readonly orderLineId: string;
  readonly fulfilledDelta: number;
  readonly cancelledDelta: number;
}

export interface PlaceFulfillmentHoldInput {
  readonly workId: string;
  readonly reason: HoldReason;
  readonly note?: string | null;
  /** Exactly one actor — the DB enforces the XOR. */
  readonly placedByUserId?: string | null;
  readonly placedByService?: string | null;
  readonly placedAt: Date;

  /**
   * Optimistic-concurrency precondition (#2406). When present the conditional
   * UPDATE additionally carries `"version" = :expectedVersion`, so the state
   * predicate, the version predicate and the write are ONE statement.
   *
   * Optional, and additive by design — the port's docblock reserved exactly
   * this: *"#2406 will add an `expectedVersion` precondition to the mutating
   * methods; an object shape makes that purely additive."* Omitting it keeps
   * every pre-#2406 caller byte-identical.
   *
   * Because the version rides in the same WHERE as the state guard, a caller
   * can distinguish "somebody moved it first" (version differs) from "not legal
   * / already applied" (version matches, state guard refused) — which is what
   * honours `version`'s "counts state changes, not writes" contract instead of
   * reporting an idempotent replay as a stale-token 409.
   */
  readonly expectedVersion?: number;
}

export interface ReleaseFulfillmentHoldInput {
  readonly holdId: string;
  /**
   * The work the hold belongs to. Required only to version-guard the header
   * (#2406); the hold row itself is found by `holdId` alone, so a caller that
   * passes no `expectedVersion` may omit it.
   */
  readonly workId?: string;
  readonly releasedAt: Date;
  readonly releasedByUserId?: string | null;
  readonly releaseNote?: string | null;  /**
   * Optimistic-concurrency precondition (#2406). When present the conditional
   * UPDATE additionally carries `"version" = :expectedVersion`, so the state
   * predicate, the version predicate and the write are ONE statement.
   *
   * Optional, and additive by design — the port's docblock reserved exactly
   * this: *"#2406 will add an `expectedVersion` precondition to the mutating
   * methods; an object shape makes that purely additive."* Omitting it keeps
   * every pre-#2406 caller byte-identical.
   *
   * Because the version rides in the same WHERE as the state guard, a caller
   * can distinguish "somebody moved it first" (version differs) from "not legal
   * / already applied" (version matches, state guard refused) — which is what
   * honours `version`'s "counts state changes, not writes" contract instead of
   * reporting an idempotent replay as a stale-token 409.
   */
  readonly expectedVersion?: number;
}

export interface ClaimFulfillmentDispatchInput {
  readonly workId: string;
  /**
   * `unsubmitted` is a first dispatch; `rejected` is a router-driven RE-REQUEST,
   * the only thing that legitimately bumps the counter. An empty list can never
   * match and reports "not claimed" rather than raising on `IN ()`.
   */
  readonly from: readonly FulfillmentRequestStatus[];
}

export interface RecordFulfillmentAcceptanceInput {
  readonly workId: string;
  /** The HOLDER's instant, `null` when it reported none. Never `new Date()`. */
  readonly acceptedAt: Date | null;
  readonly externalWorkId: string | null;
}

export interface RecordFulfillmentRejectionInput {
  readonly workId: string;
  readonly orderId: string;
  readonly connectionId: string;
  readonly assignmentAttempt: number;
  readonly reason: string;
  readonly blocking: boolean;
  readonly detail: string | null;
  /** OL's observation instant — this one IS ours, unlike `acceptedAt`. */
  readonly rejectedAt: Date;
}

/**
 * One verified unit (#2418, story E1).
 *
 * NAMES A LINE AND NOTHING ELSE. There is no barcode here and no `source`,
 * because D20 requires a hand-confirmed unit to be recorded identically to a
 * scanned one — and a shape that cannot express the difference is a guarantee,
 * where a convention is a hope. The scanned value is resolved to a line before
 * this call and then discarded.
 */
export interface RecordParcelVerificationInput {
  readonly workId: string;
  readonly workLineId: string;
  /** #2416's durable per-gesture id. The uniqueness key; see the unique index. */
  readonly gestureId: string;
  readonly verifiedByUserId: string | null;
  readonly verifiedAt: Date;
}

/** How many ACTIVE units are recorded against each line of a work. */
export interface ParcelVerifiedCount {
  readonly workLineId: string;
  readonly verifiedQuantity: number;
}

/** Shutting the box on the last verification (#2418, D18). */
export interface ClaimParcelCloseInput {
  readonly workId: string;
  readonly closedAt: Date;
  /** The LAST verifier owns the parcel (D13). `null` where none is attributable. */
  readonly packedByUserId: string | null;
}

/** Opening it again (#2418, E6/D19). */
export interface ReopenParcelWriteInput {
  readonly workId: string;
  readonly reopenedByUserId: string | null;
  readonly reopenedAt: Date;
  /**
   * The optimistic token, as `cancel` / `setExpedited` / `transitionStatus` and
   * both hold methods all take one. A reopen issued against a stale view is
   * exactly D21's scenario — the work moved underneath the packer — so the token
   * is honoured here rather than trusted.
   */
  readonly expectedVersion?: number;
}

export interface FulfillmentWorkRepositoryPort {
  /**
   * Header + lines in ONE transaction; `transaction` lets a caller compose it
   * into its own (ADR-054 R1).
   *
   * **If this throws inside a caller-supplied transaction, that transaction is
   * already aborted** — Postgres fails every subsequent statement on it with
   * `25P02`. A translated `DuplicateFulfillmentWorkLineError` therefore means
   * "roll back and fix the input", never "retry this call on the same handle".
   */
  create(
    input: CreateFulfillmentWorkInput,
    transaction?: FulfillmentWorkTransaction
  ): Promise<FulfillmentWork>;

  /**
   * Run `fn` inside ONE transaction, handing it the handle `create` and
   * `RoutingDecisionRepositoryPort.terminalise` both accept.
   *
   * #2392 gave callers a way to JOIN a transaction but no way to START one, and
   * predicted this: *"#2395 sits one transition away from wanting the same seam
   * … Widening it is #2395's call."* This is that widening, and it is what makes
   * ADR-054 R1 expressible — N work rows and the routing decision's
   * terminalisation commit together or not at all.
   *
   * The handle stays the opaque `FulfillmentWorkTransaction`, never an
   * `EntityManager`: the domain layer may not name framework code, and an
   * in-memory fake must stay typable.
   *
   * **`fn` throwing rolls the transaction back**, which is the contract the
   * caller relies on — a partial commit here is unfulfilled or double-committed
   * physical work.
   */
  runInTransaction<T>(fn: (transaction: FulfillmentWorkTransaction) => Promise<T>): Promise<T>;

  findById(workId: string): Promise<FulfillmentWork | null>;
  findByOrderId(orderId: string): Promise<FulfillmentWork[]>;

  /**
   * The worklist read (#2406) — filtered, ordered and BOUNDED.
   *
   * Ordered `createdAt DESC, id DESC`: `createdAt` alone is not unique, so a
   * page boundary landing inside a same-timestamp run would drop or repeat rows
   * between pages. The id is the tiebreak that makes the page stable.
   */
  listWorks(filter: FulfillmentWorkListFilter): Promise<FulfillmentWorkPage>;

  /**
   * The ids of every work object covering each of these orders, ordered
   * `createdAt, id`, keyed by order id (#2416).
   *
   * Exists so a caller can say *"parcel 1 of 2"* truthfully. The denominator is
   * EVERY work for the order — whatever its status, whoever holds it — because
   * a filtered read cannot answer it: a sibling parcel that is closed, routed to
   * another executor or not yet accepted is absent from such a page, so the
   * count would be wrong precisely on the split orders the number exists for,
   * while reading authoritative.
   *
   * Ids only, and BATCHED across the whole page: hydrating sibling aggregates
   * would be a second worklist read, and asking per row would be an N+1 on the
   * bench's hottest read. An order with no works is simply absent from the map.
   */
  listWorkIdsByOrderIds(orderIds: readonly string[]): Promise<Map<string, string[]>>;

  transitionStatus(input: TransitionFulfillmentWorkStatusInput): Promise<boolean>;
  transitionRequestStatus(input: TransitionFulfillmentRequestStatusInput): Promise<boolean>;

  /** Assign a holder to work that currently has none. */
  assignHolder(workId: string, connectionId: string): Promise<boolean>;
  /** Clear the holder after a rejection. */
  clearHolder(workId: string): Promise<boolean>;

  /**
   * Claim a dispatch: move `requestStatus` to `submitted` and increment
   * `assignmentAttempt`, in ONE conditional UPDATE, returning the attempt the
   * statement persisted — or `null` when the guard did not hold.
   *
   * **The attempt reaches the caller only via `RETURNING` from the statement
   * that wrote it**, so minting an idempotency key without the row already
   * holding that value is not expressible. That is stronger than asserting call
   * order in a spec, and it is the whole point: `work:{workId}:{attempt}` must
   * be stable across a job retry, and a key minted ahead of its row is a second
   * fulfilment request to a 3PL — a double-ship.
   *
   * This REPLACES #2392's `incrementAssignmentAttempt`, whose `WHERE` was
   * `"id" = :id` alone: with no state guard, any caller could bump the counter
   * out from under a live `submitted` dispatch and invalidate an in-flight key.
   * It had no production callers.
   */
  claimDispatchAttempt(input: ClaimFulfillmentDispatchInput): Promise<number | null>;

  /**
   * Record a holder's acceptance: `requestStatus`, `acceptedAt` and
   * `externalWorkId` in one guarded UPDATE.
   *
   * Guarded on `"requestStatus" = 'submitted' AND "acceptedAt" IS NULL`. The
   * second conjunct is ADR-054's at-most-once acceptance claim, and it is not
   * decoration: it is the guard that still holds if a future writer moves
   * `requestStatus` without coming through here.
   *
   * `false` = a peer recorded the answer first. An ordinary outcome, not an error.
   */
  recordAcceptance(input: RecordFulfillmentAcceptanceInput): Promise<boolean>;

  /**
   * Record a holder's refusal: the guarded `submitted -> rejected` transition
   * and the rejection row, in ONE transaction.
   *
   * If the guard does not apply, nothing is inserted — durability and rollback
   * are different assertions and each is pinned by its own spec.
   */
  recordRejection(input: RecordFulfillmentRejectionInput): Promise<boolean>;

  /**
   * The holders excluded from re-sourcing this work, most recent first.
   *
   * This slice RECORDS and EXPOSES the exclusion; selecting on it is #2395's.
   */
  listBlockingRejections(workId: string): Promise<FulfillmentWorkRejection[]>;

  /** At-most-once claim, `WHERE "dispatchRelayedAt" IS NULL`. #2401 is the caller. */
  claimDispatchRelay(workId: string, at: Date): Promise<boolean>;

  /**
   * Give the relay slot back, so a later progress event can re-drive it (#2401).
   *
   * **Conditional (`AND "dispatchRelayedAt" IS NOT NULL`), unlike the shipping
   * precedent it is otherwise modelled on.** `ShipmentRepository.releaseWaybillRelay`
   * is an unconditional `SET waybillRelayedAt = null`, and can afford to be: that
   * table carries no optimistic-concurrency token. Here `version` counts STATE
   * CHANGES, not writes, and `applyGuardedUpdate` bumps it on every applied header
   * write — so an unconditional release would bump `version` on a row it did not
   * change and hand #2406's consumer a spurious stale-token 409.
   *
   * `Promise<void>` rather than `boolean`: the only thing a boolean could
   * distinguish is "already released", which no caller may branch on. A zero-row
   * release is logged at debug instead, since a claim holder releasing nothing is
   * worth seeing.
   */
  releaseDispatchRelay(workId: string): Promise<void>;

  cancel(input: CancelFulfillmentWorkInput): Promise<boolean>;

  /**
   * Push a work ahead of ordinary deadline order, or take it back (#2416, D22).
   *
   * `expeditedAt` is the instant for an expedite and `null` for a release; the
   * conditional UPDATE carries the matching state guard (`IS NULL` / `IS NOT
   * NULL`) so a replay is refused rather than silently re-stamping a new instant
   * and re-ordering two already-expedited parcels against each other.
   *
   * Answers `false` when nothing was applied — the port's convention — which the
   * worklist service then explains as a stale token or an illegal action.
   */
  setExpedited(input: SetFulfillmentWorkExpeditedInput): Promise<boolean>;

  recordLineProgress(input: RecordFulfillmentLineProgressInput): Promise<boolean>;

  /** Raises `FulfillmentHoldLimitExceededError` past `FULFILLMENT_HOLD_ACTIVE_LIMIT`. */
  placeHold(input: PlaceFulfillmentHoldInput): Promise<FulfillmentHold>;

  /**
   * Raises `FulfillmentHoldNotFoundError` or `FulfillmentHoldAlreadyReleasedError` —
   * the two zero-row causes are different facts.
   */
  releaseHold(input: ReleaseFulfillmentHoldInput): Promise<FulfillmentHold>;

  listActiveHolds(workId: string): Promise<FulfillmentHold[]>;

  /**
   * The BATCHED sibling of `listActiveHolds`, for the worklist read (#2406).
   *
   * One query for the whole page rather than one per work: at `limit = 100` the
   * per-work call in a loop is 100 queries. Batched once BEFORE the loop, never
   * inside it — the `getEarliestOrderDateByConnection` (#2083) precedent.
   *
   * Keyed by work id. A work with no active hold is absent from the map rather
   * than present with an empty array, so a caller must default.
   */
  listActiveHoldsForWorks(workIds: readonly string[]): Promise<Map<string, FulfillmentHold[]>>;

  /**
   * Take a row lock on the work and read it with its lines, inside `transaction`
   * (#2418, stories E3/E5).
   *
   * **This is what makes over-packing enforceable.** The cap is per line and
   * greater than one, so no unique index can express it: at READ COMMITTED two
   * concurrent verifications each count `n`, each insert, and the line lands at
   * `n + 2` against a cap of `n + 1` with nothing raised anywhere. The
   * conflicting row is a PHANTOM, so it cannot be locked before it exists and a
   * `SELECT` guard enforces nothing — only the parent row serialises
   * count-then-insert. That is the identical adjudication `fulfillment_holds`
   * already carries for its ≤10 active-hold cap, one table over, and the reason
   * a trigger was rejected there applies here too: the integration harness
   * builds schema by `synchronize`, which emits none.
   *
   * It is also the serialisation point between a completing verification and a
   * concurrent reopen, which would otherwise re-shut a box the reopener had
   * just opened.
   *
   * Returns `null` when there is no such work.
   */
  lockWorkForVerification(
    workId: string,
    transaction: FulfillmentWorkTransaction
  ): Promise<FulfillmentWork | null>;

  /**
   * Record one verified unit at the pack bench (#2418, story E1).
   *
   * Answers `true` when a row was written and `false` when this exact gesture
   * was already recorded — a retry, a sleeping tablet, a reflex double-trigger
   * on ONE physical action. The discrimination is
   * `UQ_fulfillment_work_verifications_gesture` and an `ON CONFLICT DO NOTHING`,
   * never a read-then-insert: at READ COMMITTED the conflicting row is a phantom
   * that cannot be locked before it exists, so a `SELECT` guard enforces nothing
   * (the `fulfillment_progress_claims` reasoning, one table over).
   *
   * `false` is therefore an ordinary, successful outcome and never an error.
   */
  recordParcelVerification(
    input: RecordParcelVerificationInput,
    transaction?: FulfillmentWorkTransaction
  ): Promise<boolean>;

  /**
   * Active verified units per line, for ONE work.
   *
   * Reads only rows with `voidedAt IS NULL`, which is what the partial index
   * serves. A line with no verified unit is ABSENT from the array rather than
   * present with a zero, so a caller must default — the `listActiveHoldsForWorks`
   * convention.
   *
   * Takes the transaction handle so the recount that decides whether to shut the
   * box sees the row the same transaction just inserted, and so two concurrent
   * verifications cannot both read a pre-insert count and both decide they were
   * not the last (see `FulfillmentVerificationService`).
   */
  countParcelVerifications(
    workId: string,
    transaction?: FulfillmentWorkTransaction
  ): Promise<ParcelVerifiedCount[]>;

  /**
   * Shut the box (#2418, D18) — `parcelClosedAt` and `packedByUserId` in ONE
   * guarded UPDATE (`WHERE "parcelClosedAt" IS NULL`).
   *
   * The guard is the at-most-once claim, the `claimWaybillRelay` /
   * `recordAcceptance` idiom: two concurrent completing verifications race here
   * and exactly one wins, so a parcel is never closed twice and
   * `packedByUserId` is never rewritten by the loser.
   *
   * It bumps `version` like every other header write on this port, because that
   * token counts STATE CHANGES and a client polling the parcel must see the
   * close as one.
   *
   * `packedByService` is deliberately NOT written: `CHK_fulfillment_works_packed_actor`
   * makes the two mutually exclusive, and a bench close always has a user.
   */
  claimParcelClose(
    input: ClaimParcelCloseInput,
    transaction?: FulfillmentWorkTransaction
  ): Promise<boolean>;

  /**
   * Open it again (#2418, E6) — clear `parcelClosedAt` and the attribution, and
   * VOID every active verification, in one transaction.
   *
   * Voiding rather than deleting is what makes the reopen auditable: the rows'
   * `voidedAt` / `voidedByUserId` ARE the record of who reopened it and when, so
   * no second table and no `lastReopenedAt` column exists.
   *
   * Voiding rather than KEEPING the counts is forced: a closed parcel's counts
   * are by definition full, so keeping them would re-shut the box on the next
   * recount and "verification resumes" would be unexpressible.
   *
   * Guarded on `"parcelClosedAt" IS NOT NULL`; answers `false` when there was
   * nothing to reopen. Refusing a SHIPPED parcel is the service's, because the
   * fact lives in a sibling context this leaf may not read.
   */
  reopenParcel(
    input: ReopenParcelWriteInput,
    transaction?: FulfillmentWorkTransaction
  ): Promise<boolean>;
}
