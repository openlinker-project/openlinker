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
machines**: custody (`advised → in_transit → received → inspected → disposed | not_returned`) ×
money (`not_refundable | pending → triggered → refunded | denied`) — never collapsed, because
marketplaces routinely refund before goods arrive. Disposition is `restock | scrap` only (a
disposition whose consequence nobody executes is the Wave-4 failure mode). **Restock writes to the
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

## References

- Related issues: #2036, #2076
- Related ADRs: [ADR-044](./044-order-changeset-proposed-then-confirmed.md), [ADR-041](./041-sales-document-routing-policy.md), [ADR-042](./042-fiscalization-capability.md), [ADR-028](./028-order-cancellation-stock-restore.md)
- Design doc: [DESIGN-oms-authority-model](../../plans/analysis/DESIGN-oms-authority-model.md) §7
