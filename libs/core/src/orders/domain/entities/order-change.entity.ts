/**
 * Order Change Domain Entity (#2333, ADR-044)
 *
 * One **change proposal** against one target of one order: OL proposes, the
 * authority disposes, OL confirms from observation.
 *
 * **`kind` names the verb OL asked for; `status` names what happened to the
 * asking.** A `kind: 'return.decline'` row whose `status` is `'declined'` means
 * the marketplace refused OL's request — not that the return was declined. See
 * `order-change.types.ts` for the full statement of the rule.
 *
 * Anemic and fully `readonly` per ADR-011, with one pure derivation
 * ({@link OrderChange.isOpen}) that reads only its own already-loaded field.
 *
 * `internalOrderId` is **non-nullable**, and that is load-bearing rather than
 * incidental: every ADR-044 change is a change *to an order*, so an unattributed
 * return cannot produce a row here at all. The "refuse `return.decline` for an
 * orphan return" rule is therefore enforced by the schema as well as by the
 * service. There is no FK to `order_records` — the `refund_records` /
 * `invoice_records` precedent of an indexed reference by value.
 *
 * `appliedAt` guards APPLICATION of a confirmed change, never double-confirm
 * (confirmation is itself a conditional UPDATE). ADR-044's withdrawn claim
 * stands withdrawn: it does **not** subsume `Shipment.waybillRelayedAt`, which
 * is claim-then-release and stays where it is.
 *
 * @module libs/core/src/orders/domain/entities
 */
import {
  isOpenOrderChangeStatus,
  type OrderChangeKind,
  type OrderChangeStatus,
} from '../types/order-change.types';

export class OrderChange {
  constructor(
    /**
     * A plain uuid, deliberately — not an `ol_orderchange_*` internal id.
     *
     * The sibling `returns` mints `ol_return_*` because it is an aggregate root
     * an operator names. A change proposal is an internal audit row that no
     * external system names and that is never mapped through
     * `identifier_mappings`, so it takes the `return_lines` shape. There is no
     * `CoreEntityTypeValues` member and no `ENTITY_TYPE_ID_PREFIX` override; a
     * later reader should not "fix" the omission.
     */
    public readonly id: string,
    public readonly internalOrderId: string,
    public readonly kind: OrderChangeKind,
    /** The thing being mutated — never the order alone. See the types file. */
    public readonly targetRef: string,
    public readonly status: OrderChangeStatus,
    public readonly payload: Record<string, unknown> | null,
    public readonly requestedBy: string | null,
    public readonly requestedAt: Date,
    public readonly confirmedBy: string | null,
    public readonly confirmedAt: Date | null,
    /** Why the AUTHORITY refused OL's request. Never why OL asked. */
    public readonly declinedReason: string | null,
    public readonly appliedAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date
  ) {}

  /** Whether this proposal still holds its `(internalOrderId, targetRef)` slot. */
  isOpen(): boolean {
    return isOpenOrderChangeStatus(this.status);
  }
}
