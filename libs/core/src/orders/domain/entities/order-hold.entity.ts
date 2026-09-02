/**
 * Order Hold Domain Entity (#2338, DESIGN §6.3)
 *
 * One hold against one order — the record that OpenLinker deliberately stopped
 * this order, who stopped it, why, and (once released) who let it go again.
 *
 * Anemic and fully `readonly` per ADR-011, with one pure derivation
 * ({@link OrderHold.isOpen}) that reads only its own already-loaded field — no
 * clock, no parameters, no I/O.
 *
 * **`releasedAt` is the state.** There is no `status` column and no boolean: a
 * released hold is one that carries a release timestamp, matching every other
 * at-most-once marker in the tree (`waybillRelayedAt`, `cancelledAt`,
 * `fxStampedAt`, `appliedAt`) at the same storage cost — and the timestamp is
 * needed regardless, since T3 automation reads how long a hold has been open.
 *
 * `internalOrderId` is non-nullable and carries **no FK** to `order_records` —
 * the `refund_records` / `invoice_records` / `order_changes` precedent of an
 * indexed reference by value, avoiding cross-table lock coupling. `setup.ts`
 * therefore lists `order_holds` in `tablesToTruncate` explicitly: nothing
 * cascades into it.
 *
 * @module libs/core/src/orders/domain/entities
 */
import type { HoldReason } from '@openlinker/core/order-lifecycle';

export class OrderHold {
  constructor(
    /**
     * A plain uuid, deliberately — not an `ol_hold_*` internal id.
     *
     * A hold is an internal audit row that no external system names and that
     * never passes through `identifier_mappings`, so it takes the
     * `order_changes` / `return_lines` shape. There is no `CoreEntityTypeValues`
     * member and no `ENTITY_TYPE_ID_PREFIX` override; a later reader should not
     * "fix" the omission.
     */
    public readonly id: string,
    public readonly internalOrderId: string,
    public readonly reason: HoldReason,
    /** Operator free text. Never buyer data. */
    public readonly note: string | null,
    /**
     * Exactly one of {@link OrderHold.placedByUserId} /
     * {@link OrderHold.placedByService} is set on every row — a DB `CHECK`
     * (`CHK_order_holds_actor`), not a convention.
     */
    public readonly placedByUserId: string | null,
    public readonly placedByService: string | null,
    /** The backing fact for automation trigger T3 ("on hold for N days"). */
    public readonly placedAt: Date,
    /** Null while the hold is open. Stamped once, by a conditional UPDATE. */
    public readonly releasedAt: Date | null,
    public readonly releasedByUserId: string | null,
    public readonly releaseNote: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date
  ) {}

  /**
   * Whether this hold still holds its order's slot.
   *
   * The predicate matches `UQ_order_holds_open_order`'s `WHERE` clause exactly,
   * so "is the order held?" and "what is holding it?" cannot disagree.
   */
  isOpen(): boolean {
    return this.releasedAt === null;
  }
}
