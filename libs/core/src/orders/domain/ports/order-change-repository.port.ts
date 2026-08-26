/**
 * Order Change Repository Port (#2333, ADR-044)
 *
 * Persistence contract for the change-proposal table — **the Wave-2 gate**
 * (#2389: "`order_changes` is built once, in #2333, and reused here — no second
 * proposal mechanism"). Wave 2 widens `OrderChangeKind` and consumes these same
 * methods; it does not add a table.
 *
 * ## The five rules a consumer may rely on
 *
 * **R1 — `kind` names the verb OL ASKS FOR; `status` names what happened to the
 * ASKING.** A `kind: 'return.decline'` row whose `status` is `'declined'` means
 * the authority refused OL's request.
 *
 * **R2 — the grain is `(internalOrderId, targetRef)`, never the order alone.**
 * ADR-044 corrected an earlier draft on exactly this point: one-open-change-per-
 * ORDER would serialize an order's shipments against each other, a liveness bug.
 * Uniqueness is a PARTIAL index over the OPEN statuses only
 * (`UQ_order_changes_open_target`), so a terminal row releases the slot. `kind`
 * is deliberately absent from the key: two different kinds open against one
 * target are a contradiction, not a parallelism.
 *
 * **R3 — `internalOrderId` is NOT NULL**, which is what makes the orphan
 * refusal structural rather than conventional.
 *
 * **R4 — the state machine, and confirmation is idempotent.** `pending` /
 * `requested` are open; `confirmed` / `declined` / `canceled` / `expired` are
 * terminal. {@link OrderChangeRepositoryPort.confirm} is a conditional UPDATE on
 * the current status, so a second confirmation affects zero rows and is a no-op
 * rather than a second application.
 *
 * **R5 — `appliedAt` guards APPLICATION, not double-confirm**, and is a
 * timestamp rather than ADR-044's spelled boolean — matching every other
 * at-most-once marker in the tree (`waybillRelayedAt`, `cancelledAt`,
 * `fxStampedAt`) at the same storage cost.
 *
 * ## Concurrency
 *
 * Every mutator is a narrow conditional UPDATE reporting `affected > 0`, per the
 * house single-writer discipline. {@link OrderChangeRepositoryPort.insertRequested}
 * recovers from a unique violation by re-selecting the winner (the
 * `IdentifierMappingRepository.insertMapping` shape), so a concurrent
 * double-click yields one row and one adapter call.
 *
 * **The TTL path is read-then-act, and it is safe without a lock.** Two callers
 * may both observe the same stale open row and both call
 * {@link OrderChangeRepositoryPort.expire}; the second affects zero rows,
 * `expired` has left the partial index, and both then race `insertRequested`,
 * where the index admits exactly one and the loser re-selects it. A per-target
 * lock would buy nothing and is deliberately not taken.
 *
 * This port is INTRA-context: a sibling context reaches it through
 * `IOrderChangeService`, never directly
 * (`docs/architecture-overview.md § Cross-context dependencies in core`).
 *
 * @module libs/core/src/orders/domain/ports
 * @see docs/architecture/adrs/044-order-changeset-proposed-then-confirmed.md
 */
import type { OrderChange } from '../entities/order-change.entity';
import type {
  CreateOrderChangeInput,
  OrderChangeKind,
} from '../types/order-change.types';

/** What {@link OrderChangeRepositoryPort.insertRequested} did. */
export interface InsertOrderChangeResult {
  change: OrderChange;
  /** `false` when a peer already held the slot and its row was returned instead. */
  inserted: boolean;
}

export interface OrderChangeRepositoryPort {
  /**
   * The open proposal holding this target's slot, if any.
   *
   * Matches the partial unique index exactly, so "is the slot taken?" and "what
   * is holding it?" are one query and cannot disagree.
   */
  findOpenByTarget(
    internalOrderId: string,
    targetRef: string
  ): Promise<OrderChange | null>;

  /**
   * The most recent proposal of one kind against one target, open or terminal.
   *
   * Used to answer "what happened last time?" for an already-applied change,
   * where {@link OrderChangeRepositoryPort.findOpenByTarget} finds nothing
   * because the slot has been released.
   */
  findLatestByTarget(
    internalOrderId: string,
    targetRef: string,
    kind: OrderChangeKind
  ): Promise<OrderChange | null>;

  /**
   * Open a proposal in `requested`, or return the row that already holds the
   * slot.
   *
   * `INSERT … ON CONFLICT DO NOTHING` against `UQ_order_changes_open_target`,
   * then a re-select on a no-op insert. Never throws on contention.
   *
   * `requested` rather than `pending` because this slice's remote call is
   * synchronous — there is no queued-but-not-sent window to represent.
   *
   * **Reports `inserted` explicitly rather than leaving the caller to infer it.**
   * A caller MUST know whether it opened the proposal or inherited a peer's,
   * because only the opener may issue the remote request. Inferring that from
   * the returned row's fields (comparing `requestedAt`, say) would be correct
   * only while this implementation happens to echo the caller's own values back
   * — a database-side default or a precision truncation would silently make
   * every insert report "not mine", and no decline would ever be sent. The
   * repository knows the answer; it says it.
   */
  insertRequested(input: CreateOrderChangeInput): Promise<InsertOrderChangeResult>;

  /** `requested → confirmed`. Conditional; `false` means someone else got there. */
  confirm(id: string, at: Date, confirmedBy: string | null): Promise<boolean>;

  /**
   * `requested → declined` with the AUTHORITY's reason. Conditional.
   *
   * Note both this and {@link OrderChangeRepositoryPort.expire} stamp
   * `terminalisedAt` — it records when the proposal was ANSWERED, not that the
   * answer was yes. A consumer must therefore read `status`, never
   * `terminalisedAt IS NOT NULL`, to mean "the authority agreed": the latter also
   * matches a refusal and a timeout.
   */
  decline(id: string, at: Date, reason: string): Promise<boolean>;

  /**
   * Any open status → `expired`, releasing the target's slot.
   *
   * No reason is recorded: `declinedReason` means "the authority refused", and
   * an expiry is a structural timeout rather than a refusal. Conflating them
   * would make the column's one meaning two.
   */
  expire(id: string, at: Date): Promise<boolean>;

  /**
   * Claim the right to APPLY a confirmed change — `WHERE "appliedAt" IS NULL`.
   *
   * One-way, with no release path, which is exactly why it cannot replace the
   * claim-then-release shipping claims (ADR-044 § Consequences).
   */
  claimApplied(id: string, at: Date): Promise<boolean>;
}
