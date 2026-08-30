/**
 * Routing Decision Repository Port (#2394, ADR-054 R1, DESIGN §5.3)
 *
 * The persistence contract for the routing INTENT row.
 *
 * Framework-free, and takes input OBJECTS rather than positional arguments so a
 * later precondition can be added additively — the discipline
 * `FulfillmentWorkRepositoryPort` established.
 *
 * ## `claimIntent` takes NO transaction handle, and that is the design
 *
 * The whole point of this table is that intent is persisted and **committed**
 * before the boundary is crossed. Enrolling the claim in the caller's
 * transaction would let it roll back together with the work rows — destroying
 * exactly the ordering a lock could not supply.
 *
 * The default is already safe: a TypeORM repository uses the default entity
 * manager, not any ambient transaction the caller opened, so `claimIntent`
 * commits independently even if #2395 wraps its work creation in
 * `dataSource.transaction(...)`. Threading the manager through would break it.
 *
 * `terminalise` is the opposite — it IS the participant in #2395's
 * one-transaction commit (ADR-054 R1: N work rows plus terminalisation
 * together), so it accepts the same opaque handle `create` does.
 *
 * @module libs/core/src/fulfillment/domain/ports
 */
import type { RoutingDecision } from '../entities/routing-decision.entity';
import type {
  RoutingDecisionAbandonReason,
  RoutingDecisionState,
} from '../types/routing-decision.types';
import type { FulfillmentWorkTransaction } from './fulfillment-work-repository.port';

export interface ClaimRoutingIntentInput {
  readonly orderId: string;
  readonly routerConnectionId: string;
}

export interface TerminaliseRoutingDecisionInput {
  readonly decisionId: string;
  /** Terminal only — `live` is the state being left, never one to write. */
  readonly state: Exclude<RoutingDecisionState, 'live'>;
  readonly routerDecisionRef?: string | null;
  readonly abandonReason?: RoutingDecisionAbandonReason | null;
  /**
   * #2395 commits this together with the N work rows it created. Absent means
   * "commit on its own", which is what every caller outside that flow wants.
   */
  readonly transaction?: FulfillmentWorkTransaction;
}

export interface RoutingDecisionRepositoryPort {
  /**
   * Persist the intent to route this order, or refuse because one is live.
   *
   * @throws RoutingDecisionAlreadyLiveError when a live decision exists for the
   *   order on ANY connection — the refusal is deliberately router-agnostic
   *   (DESIGN §5.3: the guard refuses "regardless of router identity").
   */
  claimIntent(input: ClaimRoutingIntentInput): Promise<RoutingDecision>;

  /**
   * Move a live decision to a terminal state.
   *
   * Returns `false` when nothing was applied — the decision is gone or already
   * terminal. Not an error: two writers racing is a legitimate state, and the
   * `(result.affected ?? 0) > 0` shape is the house answer.
   *
   * **If this THROWS inside a caller-supplied transaction, that transaction is
   * already aborted** — Postgres fails every subsequent statement on it with
   * `25P02`. So a `FulfillmentPersistenceError` from here means "roll back the
   * whole commit", never "retry this call on the same handle". Stated because
   * #2395 calls it inside the one-transaction commit that also creates the N
   * work rows (ADR-054 R1); the same warning sits on
   * `FulfillmentWorkRepositoryPort.create` for the same reason.
   */
  terminalise(input: TerminaliseRoutingDecisionInput): Promise<boolean>;

  /** The live decision for an order, if one is held. #2395's guard read. */
  findLiveByOrderId(orderId: string): Promise<RoutingDecision | null>;

  findById(decisionId: string): Promise<RoutingDecision | null>;
}
