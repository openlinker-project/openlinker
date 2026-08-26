/**
 * Reservation Service Types (#2344, ADR-061 decision 1)
 *
 * The order-shaped vocabulary above the ledger's row-shaped one: a caller states
 * an ORDER's intent — these lines, this stamp — and the service resolves each
 * line to an inventory position before handing the whole set to
 * `ReservationRepositoryPort.claimHeld` in a single transaction.
 *
 * @module libs/core/src/inventory/application/types
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */
import type { ReservationAtpEffect, ReservationClaimOutcome } from '../../domain/types/reservation.types';

/**
 * One order line's intent.
 *
 * `quantity` is the DESIRED TOTAL for the line, never a delta — the repository
 * computes the delta against whatever is persisted, which is what makes an
 * identical replay a no-op and an amended line a delta-adjust, both without the
 * caller reading first (and therefore without a read-then-act race).
 */
export interface ReserveOrderLineInput {
  /** The SOURCE-supplied `OrderItem.id`, unique only within its own order. */
  readonly orderLineId: string;
  readonly productId: string;
  /** `null` for a product-level line; resolves against the `NULL`-variant position. */
  readonly productVariantId: string | null;
  /** Desired held quantity. Must be a positive integer. */
  readonly quantity: number;
  /**
   * An explicit position, which BYPASSES the multi-position gate.
   *
   * Passed to the repository unvalidated on purpose: the repository's guard
   * already discriminates `missing` from `stale` on its failure path, and a
   * service-side membership test against the live-candidate set would report a
   * *stale* explicit id as `missing` — a worse error than the accurate one.
   */
  readonly inventoryItemId?: string;
}

export interface ReserveForOrderInput {
  readonly orderRecordId: string;
  /**
   * Which reservations reduce ATP — **required, never defaulted**.
   *
   * A default here would be a policy decision hidden in a signature, and the
   * wrong default silently subtracts diagnostic holds from a real published
   * quantity. Supplied by the ingestion caller that holds the routing outcome,
   * and honoured ONLY when a row is newly inserted (immutable per reservation,
   * ADR-061 decision 1) — re-reserving never re-stamps it.
   */
  readonly atpEffect: ReservationAtpEffect;
  readonly lines: readonly ReserveOrderLineInput[];
  /**
   * When the holds stop being live. Defaults to `now + OL_RESERVATION_TTL_MS`.
   * Like `atpEffect`, honoured only on insert — extending an expiry is #2346's
   * state-dependent sweep, never a side effect of re-reserving.
   */
  readonly expiresAt?: Date;
  /** Clock, injected so a batch stamps one instant and tests are deterministic. */
  readonly now?: Date;
}

/**
 * Why a line was not claimed — a routine outcome, not a failure.
 *
 * An `as const` union so #2349 can add a reason without a shape change.
 *
 * - `no-position` — the variant resolved to no live `inventory_items` row.
 *   Legitimate: a variant no `InventoryMaster` connection has synced has no
 *   position, and refusing the whole order over one uncovered line would be a
 *   permanent domain rejection of a real, paid order.
 * - `already-closed` — the line already carries a TERMINAL reservation for this
 *   position, so re-holding it would resurrect a hold that was deliberately
 *   released, consumed or expired.
 */
export const SkippedReservationReasonValues = ['no-position', 'already-closed'] as const;

export type SkippedReservationReason = (typeof SkippedReservationReasonValues)[number];

export interface SkippedReservationLine {
  readonly orderLineId: string;
  readonly reason: SkippedReservationReason;
}

/**
 * What the call did, split so a caller can report the gap without a second read.
 *
 * `skipped` is deliberately not an error channel: every reason on it describes a
 * line that is correctly not held, which #2349 turns into a named fact on the
 * order.
 */
export interface ReserveForOrderResult {
  readonly granted: readonly ReservationClaimOutcome[];
  readonly skipped: readonly SkippedReservationLine[];
}

/**
 * "This order's goods have shipped — close its held reservations" (#2347).
 *
 * Order-scoped rather than line-scoped, and that is a schema fact rather than a
 * simplification: `shipments` carries `orderId`, carrier, status and tracking,
 * and **no line composition at all**, so a per-line consume is not merely
 * unimplemented but unexpressible against today's model. See
 * `IShipmentReservationConsumeService` for what that costs on a partially
 * shipped order.
 */
export interface ConsumeForOrderInput {
  readonly orderRecordId: string;
}

/**
 * What the consume did, with the two non-consuming exits kept apart.
 *
 * `alreadyTerminal` is **not** a failure and must never be folded into
 * `failed`. It is the ordinary outcome of a race the design permits: a peer
 * sweep or a cancellation moved the row out of `held` between this call's read
 * and its write. Counting it as a failure would make a healthy install report an
 * alarm on every retry — a loud false signal, which is its own defect class
 * beside the silent decline this programme keeps closing.
 */
export interface ConsumeForOrderResult {
  /** Rows moved `held → consumed` by THIS call. */
  readonly consumed: number;
  /** Rows that had already left `held` — expected, benign. */
  readonly alreadyTerminal: number;
  /** Rows that failed for any other reason. Genuinely wrong. */
  readonly failed: number;
}
