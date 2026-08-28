/**
 * Order Hold Repository Port (#2338, DESIGN §6.3 / REVIEW §3 H9)
 *
 * Persistence contract for `order_holds` — **the first OL-owned lifecycle write
 * in the OMS programme**, and the storage seam four issues chain behind
 * (#2339 service + enforcement, #2340 projection + reconcile, #2341 API, #2342
 * frontend). REVIEW H9 named this seam and its domain errors deliberately rather
 * than leaving the concurrency story to be improvised at the service layer.
 *
 * ## The four rules a consumer may rely on
 *
 * **R1 — at most ONE open hold per order.** Enforced by the PARTIAL unique index
 * `UQ_order_holds_open_order ON ("internalOrderId") WHERE "releasedAt" IS NULL`.
 * Partial, not total: releasing frees the slot, so an order can be held again.
 * A total index would make an order permanently unholdable after its first
 * release — a liveness bug of exactly the shape ADR-044 corrected for
 * `order_changes`. One-open-hold-per-order is v1's grain; Shopify's ≤10 is at
 * the *fulfilment* grain, which this design also allows once `FulfillmentWork`
 * exists (Wave 3), so stacking is not a v1 gap.
 *
 * **R2 — every row names exactly one actor**, a human or a service, enforced by
 * the `CHK_order_holds_actor` DB constraint and mirrored at the call site by the
 * `OrderHoldPlacedBy` discriminated union.
 *
 * **R3 — both mutators are double-call-safe and error-bearing.**
 * {@link OrderHoldRepositoryPort.placeIfNoneOpen} is `INSERT … ON CONFLICT`
 * translated to `OrderAlreadyOnHoldError`;
 * {@link OrderHoldRepositoryPort.releaseHeld} is a narrow conditional
 * `UPDATE … WHERE "releasedAt" IS NULL … RETURNING` translated to
 * `HoldAlreadyReleasedError`. A second call writes nothing and *says so* —
 * rather than succeeding silently, which would let #2339 emit a second `held`
 * lifecycle fact for one hold.
 *
 * **R4 — no TypeORM error type escapes this port.** Every infrastructure error
 * is translated to a named domain error
 * (`docs/engineering-standards.md § Repository Error Handling`, the
 * `DuplicateIdentifierMappingError` precedent). A `QueryFailedError` carrying a
 * code *other* than `23505` still propagates untranslated: a repository that
 * swallowed every database error would be worse than one that leaked.
 *
 * ## Concurrency
 *
 * No lock is taken and none is needed. Both mutators are single conditional
 * statements whose outcome the database decides, so two concurrent placers
 * produce one row and one loser, and two concurrent releasers produce one stamp
 * and one loser. This is why the seam is a repository primitive rather than a
 * read-then-act in the service.
 *
 * This port is INTRA-context: a sibling context reaches holds through
 * `IOrderHoldService` (#2339), never directly
 * (`docs/architecture-overview.md § Cross-context dependencies in core`). It is
 * deliberately NOT exported from `@openlinker/core/orders` — the
 * `OrderChangeRepositoryPort` precedent.
 *
 * @module libs/core/src/orders/domain/ports
 */
import type { OrderHold } from '../entities/order-hold.entity';
import type {
  PlaceOrderHoldInput,
  ReleaseOrderHoldInput,
} from '../types/order-hold.types';

export interface OrderHoldRepositoryPort {
  /**
   * Place a hold, or refuse because the order already has one open.
   *
   * @throws {OrderAlreadyOnHoldError} the order's slot is already taken.
   */
  placeIfNoneOpen(input: PlaceOrderHoldInput): Promise<OrderHold>;

  /**
   * Release an open hold, freeing the order's slot.
   *
   * @throws {HoldAlreadyReleasedError} the hold exists but was already released.
   * @throws {OrderHoldNotFoundError} no such hold. Distinguished from the above
   *   because both present as "zero rows affected", and reporting a release for
   *   a hold that never existed is a false statement about the operator's data.
   */
  releaseHeld(input: ReleaseOrderHoldInput): Promise<OrderHold>;

  /** One hold by id, open or released. Null when absent. */
  findById(id: string): Promise<OrderHold | null>;

  /**
   * The open hold on one order, if any.
   *
   * Matches `UQ_order_holds_open_order`'s predicate exactly, so "is this order
   * held?" and "what is holding it?" are one query and cannot disagree.
   *
   * This is the read #2339's provisioning gate uses. Note the epic's L4 exit
   * criterion requires the gate to read `order_holds` — this table — and NOT
   * #2340's denormalised `order_records.activeHoldReason`, which is a cache that
   * loses on drift.
   */
  findOpenByOrder(internalOrderId: string): Promise<OrderHold | null>;

  /**
   * The open holds on many orders, in one query.
   *
   * Batched for #2341's list projection: the per-row alternative is N queries
   * behind a paged table. Callers pass one page of order ids, never an unbounded
   * set.
   */
  findOpenByOrders(internalOrderIds: string[]): Promise<OrderHold[]>;

  /**
   * Every hold on one order, newest first — the operator-facing audit trail
   * (#2341's `holdHistory[]`).
   *
   * Unpaged, deliberately: one order's hold count is inherently small. If a
   * consumer ever proves otherwise, adding a page argument is additive.
   */
  listByOrder(internalOrderId: string): Promise<OrderHold[]>;

  /**
   * Open holds placed before a threshold — automation trigger T3 ("on hold for
   * N days"), and the reason `placedAt` exists while `phaseEnteredAt`
   * deliberately does not (adjudicated: a phase fed by `now` is uninvalidatable).
   *
   * **Bounded by `limit`, with no cursor, and that costs something a caller must
   * know.** With more than `limit` holds past the threshold, every call returns
   * the same head page and the tail is never reached. That is safe only if the
   * caller's action REMOVES the row from this predicate — releasing the hold, or
   * stamping something that excludes it. A caller that merely *notifies* starves
   * and needs a cursor added here first.
   */
  listOpenPlacedBefore(before: Date, limit: number): Promise<OrderHold[]>;

}
