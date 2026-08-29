/**
 * Order Change Types (#2333, ADR-044)
 *
 * The vocabulary of an ADR-044 **change proposal**: OL proposes, the authority
 * disposes, OL confirms from observation.
 *
 * ## R1 — `kind` names the verb OL ASKS FOR; `status` names what happened to the ASKING
 *
 * These read confusingly together exactly once, and it is this slice: a row with
 * `kind: 'return.decline'` and `status: 'declined'` means *the marketplace
 * refused OL's request to decline the buyer's refund*. Reading it the other way
 * inverts a commercially meaningful outcome, so the rule is stated first here
 * and repeated on the entity, the port and the migration.
 *
 * ## Not to be confused with `OrderAmendmentChange`
 *
 * `libs/core/src/orders/domain/order-amendment-diff.ts` exports
 * `OrderAmendmentChange` / `OrderAmendmentChangeKind` / `diffOrderAmendment`.
 * That is the ingestion line-diff **observation** — what the source already
 * changed, discovered by comparing two snapshots. This is a **proposal** — what
 * OL is asking a source to change, before it has. Adjacent names, opposite
 * directions; nothing converts between them.
 *
 * The pure-rule exception in `docs/engineering-standards.md` applies: the two
 * coercion guards ARE the rule for the unions they sit with, take no dependency,
 * and must be edited in the same commit as the union.
 *
 * @module libs/core/src/orders/domain/types
 * @see docs/architecture/adrs/044-order-changeset-proposed-then-confirmed.md
 */

/**
 * What OL is asking for.
 *
 * Scoped to the return actions Wave 1c ships. **Widening this is a one-line
 * edit** — there is deliberately no PostgreSQL enum and no `CHECK` constraint on
 * the column, because Wave 2 adds amendment kinds (#2389) and a database-level
 * vocabulary would cost a migration per kind and would turn an out-of-tree kind
 * into a hard write failure instead of a coercion miss.
 *
 * `return.authorize` arrived with #2372, and its RESTRICTION is the point: ADR-060
 * reserves it for `origin: 'operator_authored'` returns, because OL must not pretend
 * to decide what a marketplace already decided. Unlike `return.decline` it crosses
 * NO adapter boundary — for a return OL itself authored there is no source to ask,
 * so OL is the authority and the row here is the audit record of the operator's act
 * rather than a request awaiting an answer. That is also why it reuses this table
 * instead of growing a second proposal mechanism.
 *
 * `return.invoice_correction` arrived with #2374, and it is the first kind whose
 * `targetRef` is NOT a bare entity id — which is a constraint the shared index
 * imposes, not a stylistic choice. `UQ_order_changes_open_target` is
 * `(internalOrderId, targetRef)` and **does not include `kind`**, so every kind
 * sharing an order competes for one slot per `targetRef`. The bare `ReturnRecord.id`
 * namespace is already taken by the two kinds above; and keying on the invoice
 * record id instead would collide across RETURNS, because an order legitimately
 * produces several (partial returns arriving in waves) each proposing against the
 * same document — the second build would find the first return's open row and
 * terminalise a proposal an operator was mid-review on. The key is therefore
 * `correction:{returnId}:{invoiceRecordId}`: unique per (return, document), and
 * namespaced so it cannot intrude on a sibling kind's. **A kind added after this
 * one faces the identical question** — check the namespace before picking a
 * `targetRef`, because the index will not.
 */
export const OrderChangeKindValues = [
  'return.decline',
  'return.authorize',
  'return.invoice_correction',
] as const;

export type OrderChangeKind = (typeof OrderChangeKindValues)[number];

/**
 * Where the proposal got to.
 *
 * ```
 * pending ──▶ requested ──▶ confirmed  (the authority applied it)
 *                       ├─▶ declined   (the authority refused it)
 *                       ├─▶ canceled   (the requester withdrew it)
 *                       └─▶ expired    (unanswered past its TTL)
 * ```
 *
 * `pending` and `requested` are OPEN — see {@link OPEN_ORDER_CHANGE_STATUSES},
 * which is what the partial unique index keys on. Everything else is terminal.
 *
 * ADR-044 spells these uppercase in prose; the repository's `as const` union
 * convention is lowercase, and the column stores what this union says.
 *
 * `expired` is **not** an extension (ADR-044 § "Expiry is mandatory"): with a
 * uniqueness index and no terminal path for an unanswered request, one hung
 * remote call would leave that target permanently unmutable.
 */
export const OrderChangeStatusValues = [
  'pending',
  'requested',
  'confirmed',
  'declined',
  'canceled',
  'expired',
] as const;

export type OrderChangeStatus = (typeof OrderChangeStatusValues)[number];

/**
 * The statuses that hold the `(internalOrderId, targetRef)` slot.
 *
 * Exported so no consumer — SQL predicate, service branch or test — ever
 * hand-lists them and drifts from the index's `WHERE` clause.
 */
export const OPEN_ORDER_CHANGE_STATUSES: readonly OrderChangeStatus[] = ['pending', 'requested'];

/** Pure coercion. No default — an unrecognised kind must never become another. */
export function isOrderChangeKind(value: unknown): value is OrderChangeKind {
  return typeof value === 'string' && (OrderChangeKindValues as readonly string[]).includes(value);
}

/** Pure coercion. No default — see {@link isOrderChangeKind}. */
export function isOrderChangeStatus(value: unknown): value is OrderChangeStatus {
  return (
    typeof value === 'string' && (OrderChangeStatusValues as readonly string[]).includes(value)
  );
}

/** Whether a status still holds its target's slot. */
export function isOpenOrderChangeStatus(status: OrderChangeStatus): boolean {
  return OPEN_ORDER_CHANGE_STATUSES.includes(status);
}

/**
 * What a caller supplies to open a proposal.
 *
 * `targetRef` names the thing being mutated — never the order alone (ADR-044's
 * own correction of an earlier draft). For `return.decline` it is the
 * `ReturnRecord.id`.
 *
 * `payload` is kind-specific and carries **no buyer data**: for this slice, an
 * operator-chosen reason code and operator free text. The named PII gap on
 * `returns.rawPayload` does not transfer here by proximity.
 */
export interface CreateOrderChangeInput {
  internalOrderId: string;
  kind: OrderChangeKind;
  targetRef: string;
  payload: Record<string, unknown> | null;
  /** The actor who asked — an OL user id, or null for a system-initiated change. */
  requestedBy: string | null;
  requestedAt: Date;
}
