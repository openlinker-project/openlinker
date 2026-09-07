/**
 * Shipment Line Types (#2727, `DECISION-oms-fulfilment-grain` option C)
 *
 * Line-grain shipment records, so an order's shipped / delivered quantities are
 * DERIVABLE rather than inferred from shipment status alone.
 *
 * ## Why `orderId` is on the line and is not redundant
 *
 * `shipments.orderId` is the order the shipment was *dispatched for* — the one
 * the recipient address came from and the one the per-order dispatch lock is
 * keyed on. A CONSOLIDATED parcel carries units from more than one order, and
 * keeping that expressible is the whole reason option C keys on
 * `(shipmentId, orderId, lineId)` rather than on `(shipmentId, lineId)`.
 *
 * Derive the line's order from its shipment header and a line belonging to
 * order B inside a parcel headed by order A becomes UNREPRESENTABLE: order B's
 * derived shipped quantity is permanently zero and nothing says so. Every
 * writer today sets `line.orderId = shipment.orderId`; the column is what lets
 * that stop being true without a migration.
 *
 * ## Counters are a FOLD, the acts are authoritative
 *
 * A `ShipmentLine` carries counters; `ShipmentLineAct` rows carry what
 * happened. The counters are recomputed from the acts (never incremented), so
 * the ledger is the source of truth and the counter is a denormalisation — the
 * `reservations` / `inventory_items.olReservedQuantity` shape.
 *
 * That is what makes the #2727 backfill event-shaped rather than a snapshot,
 * and it is the whole reason a cancel-and-reissue cannot double-count. See
 * `checkShipmentLineCapacity` below and the backfill migration.
 *
 * @module libs/core/src/shipping/domain/types
 */

/**
 * What happened to a line's units on one shipment.
 *
 * - `ship`    — the units left the building on this shipment.
 * - `deliver` — the units arrived.
 * - `cancel`  — the units this shipment shipped were REVERSED (the AC-7
 *   cancel-and-reissue path). A shipment cancelled before it ever shipped emits
 *   no act at all: there is nothing to reverse, which is what keeps
 *   `cancelledQuantity <= shippedQuantity` true.
 *
 * The uniqueness key is `(shipmentLineId, kind, occurredAt)`.
 *
 * **`occurredAt` is IN the key because a shipment row is REUSED.** It is
 * tempting to key on `(line, kind)` alone on the reasoning that a shipment ships
 * once — but `ShipmentDispatchService` persists `failed` in its `generateLabel`
 * catch and a retry re-enters on the same `shipment.id`, so
 * `failed -> generated -> dispatched` is reachable on one row. Under a
 * `(line, kind)` key, a line that had emitted `ship` + `cancel` could never
 * record its successful re-dispatch: it would fold to a net shipped of 0 for a
 * parcel that really shipped, permanently.
 *
 * With the instant in the key, a repeated reconcile over an unchanged shipment
 * re-derives the identical tuple and inserts nothing (idempotent under a bare
 * `ON CONFLICT DO NOTHING`, with no sequence counter to allocate and therefore
 * no lock to take — which is what the returns `(returnLineId, seq)` key would
 * have required), while a genuine re-dispatch carries a new `dispatchedAt` and
 * correctly emits a second `ship` act.
 */
export const ShipmentLineActKindValues = ['ship', 'deliver', 'cancel'] as const;
export type ShipmentLineActKind = (typeof ShipmentLineActKindValues)[number];

/** One line's participation in one shipment. Counters, never per-line statuses. */
export interface ShipmentLine {
  readonly id: string;
  readonly shipmentId: string;
  /** See the module docblock — deliberately NOT derived from the shipment. */
  readonly orderId: string;
  /** The source-supplied `orderSnapshot.items[].id`. */
  readonly lineId: string;
  readonly productVariantId: string | null;
  /** Units this shipment UNDERTAKES for this line. */
  readonly quantity: number;
  readonly shippedQuantity: number;
  readonly deliveredQuantity: number;
  readonly cancelledQuantity: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** One append-only act on a shipment line. */
export interface ShipmentLineAct {
  readonly id: string;
  readonly shipmentLineId: string;
  readonly kind: ShipmentLineActKind;
  readonly quantity: number;
  /**
   * The SHIPMENT's own instant (`dispatchedAt` / `deliveredAt` /
   * `cancelledAt`-or-`failedAt`), never `new Date()`. A carrier's act happened
   * in another system and OL's clock is not a witness to it (#2336 / #2367 /
   * #2371).
   *
   * When the shipment carries no timestamp for the transition it falls back to
   * the shipment's `createdAt` — **never `updatedAt`**, which moves on every
   * write and would therefore mint a fresh duplicate act on every reconcile.
   */
  readonly occurredAt: Date;
  readonly createdAt: Date;
}

/** The four counters, as the capacity rule sees them. */
export interface ShipmentLineCapacityInput {
  readonly quantity: number;
  readonly shippedQuantity: number;
  readonly deliveredQuantity: number;
  readonly cancelledQuantity: number;
}

/**
 * The counter ordering invariant, as a pure function.
 *
 * **This is the exact twin of `CHK_shipment_lines_capacity`.** The two must
 * move together — a row one accepts and the other rejects is precisely the
 * drift `fulfillment-work-migration-parity.int-spec.ts` exists to catch, and
 * the same discipline `checkFulfillmentWorkLineCapacity` holds one context
 * over.
 *
 * Read the ordering as:
 * - you cannot deliver what you did not ship;
 * - you cannot cancel more than you shipped.
 *
 * The second clause is load-bearing rather than decorative: it is what makes
 * the NET shipped quantity (`shippedQuantity - cancelledQuantity`) non-negative
 * by construction, and that net is the number every derivation reads.
 *
 * ## Why `shippedQuantity <= quantity` is deliberately ABSENT
 *
 * The obvious third clause is a trap. Two independent paths violate it during
 * ordinary operation:
 *
 * 1. **Re-ingestion rewrites `orderSnapshot` wholesale.** `quantity` is frozen
 *    at line creation, so a line created when the snapshot said 2 and then
 *    re-ingested at 5 emits a `ship(5)` act against `quantity = 2`.
 * 2. **A dispatch retry reuses the same shipment row** (see the act-kind
 *    docblock above), so a ship-then-cancel-then-reship line legitimately folds
 *    to `shipped = 4, cancelled = 2` on a line of `quantity = 2`.
 *
 * Both would raise inside the reconcile, be swallowed by its best-effort catch,
 * and leave the read model silently non-convergent for that order — strictly
 * worse than not having the clause. `quantity` therefore records what this
 * shipment UNDERTOOK as OL understood the order at the time: provenance, not a
 * bound.
 *
 * Also deliberately not asserted: `deliveredQuantity` is not bounded by
 * `shippedQuantity - cancelledQuantity`. Cancelling an already-delivered
 * shipment is refused in the application (`ShipmentNotCancellableException`),
 * but if it ever happened the honest record is "these units were delivered AND
 * the shipment was reversed", not a row the database refuses to store. A
 * consumer computing "delivered of net shipped" can therefore see a ratio above
 * 1; nothing in this slice does.
 */
export function checkShipmentLineCapacity(line: ShipmentLineCapacityInput): boolean {
  return (
    Number.isInteger(line.quantity) &&
    Number.isInteger(line.shippedQuantity) &&
    Number.isInteger(line.deliveredQuantity) &&
    Number.isInteger(line.cancelledQuantity) &&
    line.quantity >= 0 &&
    line.shippedQuantity >= 0 &&
    line.deliveredQuantity >= 0 &&
    line.cancelledQuantity >= 0 &&
    line.deliveredQuantity <= line.shippedQuantity &&
    line.cancelledQuantity <= line.shippedQuantity
  );
}

/**
 * Net units of a line that are still shipped — what a shipment sent and did not
 * take back. The single definition; nothing recomputes `shipped - cancelled`
 * anywhere else.
 */
export function netShippedQuantity(line: ShipmentLineCapacityInput): number {
  return line.shippedQuantity - line.cancelledQuantity;
}

/**
 * How much of an order the shipment ledger accounts for, as
 * `deriveFulfillmentRollup` consumes it (#2727).
 *
 * OPTIONAL at the call site, deliberately: an install that has not run the
 * backfill, or an order whose snapshot carried no items, has no line data at
 * all — and the rollup must still answer for those. Absent means "no line
 * data", never "zero delivered".
 *
 * ## The numerator is an OVER-estimate, and the rule is sound anyway
 *
 * The backfill (and the runtime writer) attribute each shipment of a line the
 * line's FULL quantity, because OL never recorded the real per-package split.
 * So a two-package line of quantity 2 reports `delivered = 2` once ONE package
 * arrives.
 *
 * That does not make the coverage rule wrong, because the rule only ever
 * DEMOTES (`delivered < ordered` ⇒ not delivered) and there is no branch that
 * promotes anything. An over-estimate that is STILL short proves the truth is
 * shorter, so a false demotion is impossible — only a missed one. Per line the
 * numerator is additionally clamped to that line's ordered quantity, which can
 * never drop below the true count and strictly improves precision.
 *
 * Its known blind spot is exactly that partially-delivered multi-package line,
 * where the over-count hides the shortfall. That case is caught by the STATUS
 * half of the rollup instead (the sibling package is still in progress). The
 * two halves cover different failures, which is why both exist.
 */
export interface FulfillmentQuantityCoverage {
  /** Units the order requires across all its lines. */
  readonly ordered: number;
  /**
   * Net units delivered across the order's OUTBOUND shipments, clamped per line
   * to that line's ordered quantity. See the over-estimate note above.
   */
  readonly delivered: number;
}
