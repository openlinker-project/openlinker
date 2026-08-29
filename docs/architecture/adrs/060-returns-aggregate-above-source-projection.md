# ADR-060: Returns as an OL-owned aggregate above the source projection

- **Status**: Proposed
- **Date**: 2026-08-21
- **Authors**: @piotrswierzy

## Context

OL has no returns model; the only adjacent persistence is the capture-only `RefundRecord` (#2036).
ANALYSIS-1032's Wave 4 narrowed returns to a read-only source projection because no source reports
a derivable lifecycle (Allegro's status is an 11-value timeline; Erli's returns carry no id and no
status). Its source-shape findings stand; its scope premises do not survive the OMS goal — custody
("did the parcel arrive?") and disposition ("did I restock it?") are events in the operator's own
building, with the operator as the sensor and no source counterpart to contradict.

## Decision

Keep the projection as the **source-observation layer** and add an OL-owned aggregate above it, in
a new `returns` context: `ReturnRecord` (nullable `internalOrderId` — orphan returns persist,
surface in an operator bucket, and **block every downstream trigger**) + `ReturnLine` with
**quantity counters** (`advised ≥ received ≥ restocked + scrapped`) and **two orthogonal per-line
machines**: custody (`advised → in_transit → received → disposed | not_returned`) ×
money (`not_refundable | pending → triggered → refunded | denied | in_doubt`) — never collapsed, because
marketplaces routinely refund before goods arrive. Disposition is `restock | scrap` only (a
disposition whose consequence nobody executes is the Wave-4 failure mode). *(Amended by #2327: the
custody list above originally carried `inspected`, which the implementing slice collapsed into
`received` — nothing in the tree writes it and no shipped surface distinguishes an inspected parcel
from a received one, so it would exist only to be skipped. The reversal gate is a `ReturnReceiver`/3PL
receiving flow, where the receiving and inspecting parties genuinely differ, named in the returns
product spec § 3.1. `in_doubt` is stated explicitly on the money axis for the same reason it was
always implied: OL ships no refund write, so an unobservable execution must be recordable as
unknown rather than reported as `refunded`.)* **Restock writes to the
inventory master** via the **existing `InventoryMasterPort.adjustInventory`**, amended to carry an
idempotency key + reason on its command type (additive; not a new capability — the method already
exists on the base port, implemented by WooCommerce and refused by PrestaShop) — `inventory_items`
is a mirror the next sync overwrites — and where the implementation refuses, the line records
operator-visible `restock_blocked`, never a silent no-op. Authorization is **two ADR-044 actions**, not states
(`return.decline` — the one Allegro write; `return.authorize` — operator-authored returns only:
OL must not pretend to decide what the marketplace already decided). Ingestion is a
`ReturnSourceReader` sub-capability on `OrderSourcePort` mirroring the order feed. Refunds:
`RefundRecord` is **linked, not extended** (nullable `returnId`; `RefundReason` reused verbatim);
`refunded` is entered only on observation, and with no shipped refund-write the trigger confirms to
`executedBy: 'operator_out_of_band'`. A disposed line **proposes** an invoice correction through
the existing `CorrectionIssuer` seam, showing the positional-line ambiguity — auto-issue stays
gated on a stable `InvoiceLine` reference. Return labels are `Shipment` rows with a new
`direction: 'outbound' | 'inbound'` (note the `UQ_shipments_branch_one_per_order_conn` partial
index must gain `direction` in its predicate, or an inbound row collides — R1). The money machine
carries `in_doubt` (boundary crossed, outcome unconfirmed — blocks like `pending`, cleared only
by a terminal observation). A second enabled `ReturnsAuthority` connection resolves `ambiguous` —
no automated disposition, reason persisted and surfaced, **inert per ADR-052's matrix rule** (R1
retired the boot-time-failure clause: its blast radius — a dead deployment over a returns
misconfiguration — dwarfs the double-disposition it prevents, and the cited zero-providers boot
precedent does not transfer to a two-providers condition). `ReturnsAuthorityPort` carries
`decideDisposition` only (no `getRefundTriggerOwner` — a method whose every answer but "OL" core
must ignore under [ADR-056](./056-refund-and-fiscal-authority-never-leave-ol.md)).

### Amendment (#2370) — a line's history is a set of ACTS, beside the counters

The counters stay exactly as decided above, and `CHK_return_lines_quantity_ordering` remains the
invariant no caller can bypass. #2370 adds an **append-only per-line act ledger**
(`return_line_events`) alongside them, written in the SAME transaction as the counters it explains.

The reason is that a **counter cannot key an idempotent trigger firing**. #2360 requires a return
arriving in three parcels to fire `return.received` three times; `quantityReceived` going `1 -> 2 -> 3`
carries no per-arrival identity and is indistinguishable from a correction (a miscount fixed from 3
down to 2 and back up). It also gives the idempotency key #2368 already specified something to name —
`return:{returnId}:{lineId}:{seq}` presupposes a per-line sequence, which a counters-only model does
not have. And `restock_blocked` is a property of ONE disposition attempt, not of a line: a line may
hold an applied restock and a refused one, which a single line-level column cannot say.

The ledger is history BESIDE the invariant, never instead of it: the counters remain the CHECK-guarded
columns and are never recomputed from the acts at read time, which would move the invariant out of the
constraint's reach and put an aggregate on the hottest path.

Three consequences are decisions rather than implementation detail.

**A blocked restock does not increment `quantityRestocked`.** The ACT is the disposition and is never
rolled back — the goods really were disposed of — but the COUNTER records book-confirmed restock, and
a refused book write confirmed nothing. So the units stay in `quantityReceived` until an operator
attests (returns spec § 5.4), which is also what lets #2381 assert that no surface renders blocked
units as restocked. The consequence is that `applyReturnCustodyDisposition` is called only AFTER the
master answers and never on the blocked branch — which is why #2367 needed no amendment.

**The act is written BEFORE the adapter call, and `in_doubt` is a real state.** The ADR-056
attempted-predicate ordering: a process dying mid-call leaves a record that stock MAY have moved,
rather than silence. It never auto-retries — OL does not know whether the units landed — and its
remediation is the same operator attestation a block gets.

**Disposal is serialized per line.** The counter check is a read and the master write crosses a
provider boundary, so it is read-then-act — the shape ADR-041 §3a serializes with
`invoiceIssueLockKey`. Two concurrent disposals would otherwise both pass the check and both apply,
under different `seq` values and therefore different idempotency keys that no adapter can dedupe. The
same reasoning puts `SELECT … FOR UPDATE` on every counter write: the CHECK is silent on a lost update
(receiving 2 twice against `advised: 5` and recording 2 is perfectly legal), so the constraint and the
lock guard different failures.

**Still open, and named rather than approximated**: `not_returned` on a *partially* received line
remains refused. The shortfall needs a COUNTER (`quantityNotReturned` plus a widened CHECK), which an
acts ledger does not supply — so returns spec § 5.2's *"Mark remainder not returned"* is
unimplementable for such a line, and the shortfall stays visible as `quantityAdvised -
quantityReceived`. The fix is one column, one constraint change and one amendment to #2367's contract.

## Alternatives considered

- **Projection-only (the Wave-4 answer)**: cannot drive restock, credit notes or return-rate
  reporting; retained as a layer, not as the model.
- **Extending `RefundRecord`**: refunds exist without returns and vice versa; widening falsifies
  live analytics rows.
- **A `ReverseDelivery` / `ReverseFulfillmentWork` mirror at v1**: duplicates the reusable
  shipping context to express one bit; the middle entity earns its keep only when receive-node
  routing exists.
- **Restocking OL's own `inventory_items` when a shop is master**: the increment silently vanishes
  at the next sync tick.

## Consequences

**Pros:** returned units link to ordered lines, enabling credit notes, restock and reporting;
every write OL owns has the operator as its sensor. **Cons:** every outbound-assuming shipment
query must be audited for `direction`; the Allegro feed's cursor shape is unverified and gates
Wave 1.

*Reversal gate (prose-only):* receive-node routing becoming a real decision (multiple receiving locations)
introduces `ReverseFulfillmentWork`; a source exposing a genuinely machine-shaped return status
re-opens the verbatim-`rawStatus` rule for that source.

## Amendment (#2373) — `shipments.direction` is actioned, and the discriminator went in the index KEY

The R1 note above says the `UQ_shipments_branch_one_per_order_conn` partial index "must gain
`direction` in its predicate". #2373 implements it, with two corrections worth recording at the
source.

**It is a KEY column, not an arm of the WHERE clause.** Adding `direction = 'outbound'` to the
predicate would preserve the outbound guard and remove the return guard *entirely* — the index
would simply stop covering return rows, admitting any number of branch-1 return rows per
`(orderId, connectionId)`. The shipped form is
`UNIQUE (orderId, connectionId, direction) WHERE "providerShipmentId" IS NULL`, which admits
exactly the one pair this ADR needs and still refuses a duplicate in either direction.

**The value is `'return'`, not `'inbound'`.** The union is `'outbound' | 'return'`, matching the
context's own noun everywhere else in this ADR.

The column carries no database default (the migration's is dropped in the same `up()`), three
repository read predicates take a required `direction` argument and the paginated list takes an
optional filter — see `docs/architecture-overview.md` § 23 for why that asymmetry is deliberate.
Nothing writes `'return'` yet; buying a return label remains a later slice.

## References

- Related issues: #2036, #2076, #2327, #2367, #2368, #2369, #2370, #2373
- Related ADRs: [ADR-044](./044-order-changeset-proposed-then-confirmed.md), [ADR-041](./041-sales-document-routing-policy.md), [ADR-042](./042-fiscalization-capability.md), [ADR-028](./028-order-cancellation-stock-restore.md)
- Design doc: [DESIGN-oms-authority-model](../../plans/analysis/DESIGN-oms-authority-model.md) §7
