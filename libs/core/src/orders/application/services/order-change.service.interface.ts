/**
 * Order Change Service Interface (#2333, ADR-044)
 *
 * The cross-context seam for ADR-044 change proposals — **the Wave-2 gate**.
 * A sibling context (today `returns`, tomorrow the Wave-2 amendment paths)
 * reaches the proposal record through this interface and its Symbol token,
 * never through `OrderChangeRepositoryPort`
 * (`docs/architecture-overview.md § Cross-context dependencies in core`).
 *
 * The service owns exactly one policy the repository cannot: **lazy TTL
 * expiry**. Everything else is a thin, honest pass-through, because the caller
 * — not this service — knows what its remote call did.
 *
 * @module libs/core/src/orders/application/services
 */
import type { OrderChange } from '../../domain/entities/order-change.entity';
import type {
  CreateOrderChangeInput,
  OrderChangeKind,
} from '../../domain/types/order-change.types';

/** What {@link IOrderChangeService.openOrReuse} did. */
export interface OpenOrderChangeResult {
  change: OrderChange;
  /**
   * `false` when an OPEN proposal already held the target's slot and was
   * returned instead of a new one.
   *
   * A caller MUST branch on this: reusing an open proposal means the remote
   * call is already in flight (or was, within the TTL), so issuing a second one
   * would double the request the ADR-044 slot exists to prevent.
   */
  opened: boolean;
  /** `true` when a stale open proposal was expired to make room for this one. */
  expiredStale: boolean;
}

export interface IOrderChangeService {
  /**
   * Open a proposal, or return the one already holding
   * `(internalOrderId, targetRef)`.
   *
   * An open proposal older than the configured TTL is **expired first** and a
   * fresh one opened. That is ADR-044's mandated terminal path for an
   * unanswered request, made concrete for a mutation with no driving sync job:
   * without it, one hung remote call would leave the target permanently
   * unmutable. Expiry is lazy — the next attempt performs it — because the only
   * actor who cares that the slot is held is the operator standing in front of
   * it, and a cron with no other work is a worse answer.
   */
  openOrReuse(input: CreateOrderChangeInput): Promise<OpenOrderChangeResult>;

  /**
   * `requested → confirmed`. Idempotent: a second call affects zero rows and
   * reports `false` rather than confirming twice.
   */
  confirm(id: string, confirmedBy: string | null): Promise<boolean>;

  /**
   * `requested → declined` — the AUTHORITY refused OL's request. `reason` is
   * the authority's, and becomes a queryable outcome instead of an error
   * swallowed at a call site (ADR-044's headline benefit).
   */
  decline(id: string, reason: string): Promise<boolean>;

  /**
   * Terminalise a proposal that was NEVER PUT to the authority — the request
   * failed OL's own pre-flight validation, so nobody was asked and nobody
   * refused.
   *
   * It resolves to `expired` rather than `declined` because `declinedReason`
   * means "the authority refused" and nothing else; recording a bad
   * operator-supplied field there would put words in the source's mouth and
   * make the column's one meaning two — the same argument that keeps a TTL
   * timeout out of it. Releasing the target's slot immediately is the point:
   * without it a typo would hold the slot for a full TTL and block the
   * corrected retry.
   */
  abandon(id: string): Promise<boolean>;

  /**
   * Claim the right to APPLY a confirmed change.
   *
   * One-way and without a release path, so it guards application only — never
   * double-confirm, and never one of the claim-then-release shipping claims.
   */
  claimApplied(id: string): Promise<boolean>;

  /** The most recent proposal of one kind against one target, open or terminal. */
  findLatestByTarget(
    internalOrderId: string,
    targetRef: string,
    kind: OrderChangeKind
  ): Promise<OrderChange | null>;
}
