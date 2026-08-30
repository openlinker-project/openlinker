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
import type { FulfillmentWorkStatus } from '../types/fulfillment-work-status.types';

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
  readonly to: FulfillmentWorkStatus;
}

/** Move the NEGOTIATION axis, guarding on the request status it is moving from. */
export interface TransitionFulfillmentRequestStatusInput {
  readonly workId: string;
  readonly from: readonly FulfillmentRequestStatus[];
  readonly to: FulfillmentRequestStatus;
}

/** Force-close or negotiated cancel. ADR-054 requires a reason on every one. */
export interface CancelFulfillmentWorkInput {
  readonly workId: string;
  readonly reason: FulfillmentCancellationReason;
  readonly cancelledAt: Date;
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
}

export interface ReleaseFulfillmentHoldInput {
  readonly holdId: string;
  readonly releasedAt: Date;
  readonly releasedByUserId?: string | null;
  readonly releaseNote?: string | null;
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

  findById(workId: string): Promise<FulfillmentWork | null>;
  findByOrderId(orderId: string): Promise<FulfillmentWork[]>;

  transitionStatus(input: TransitionFulfillmentWorkStatusInput): Promise<boolean>;
  transitionRequestStatus(input: TransitionFulfillmentRequestStatusInput): Promise<boolean>;

  /** Assign a holder to work that currently has none. */
  assignHolder(workId: string, connectionId: string): Promise<boolean>;
  /** Clear the holder after a rejection. */
  clearHolder(workId: string): Promise<boolean>;

  /** Monotonic; #2399's re-request. Written before the outbound call (ADR-054 R1). */
  incrementAssignmentAttempt(workId: string): Promise<boolean>;

  /** At-most-once claim, `WHERE "dispatchRelayedAt" IS NULL`. #2401 is the caller. */
  claimDispatchRelay(workId: string, at: Date): Promise<boolean>;

  cancel(input: CancelFulfillmentWorkInput): Promise<boolean>;

  recordLineProgress(input: RecordFulfillmentLineProgressInput): Promise<boolean>;

  /** Raises `FulfillmentHoldLimitExceededError` past `FULFILLMENT_HOLD_ACTIVE_LIMIT`. */
  placeHold(input: PlaceFulfillmentHoldInput): Promise<FulfillmentHold>;

  /**
   * Raises `FulfillmentHoldNotFoundError` or `FulfillmentHoldAlreadyReleasedError` —
   * the two zero-row causes are different facts.
   */
  releaseHold(input: ReleaseFulfillmentHoldInput): Promise<FulfillmentHold>;

  listActiveHolds(workId: string): Promise<FulfillmentHold[]>;
}
