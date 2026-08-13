# ADR-041: Pack policy as a validated per-connection config pair; the flow entity is deferred

- **Status**: Proposed
- **Date**: 2026-08-13
- **Authors**: @piotrswierzy

## Context

The OMS workbench must adapt to different warehouse processes: barcode scan versus manual tick
(a catalogue with missing EANs cannot be fully scanned), and whether an unverified order may still
dispatch.

This ADR originally proposed a named **`OrderFlow`** entity — stage pipeline plus four policy axes
plus a disableable-guard allowlist, assigned per order — modelled on Fluent's `orderType`-in-the-
workflow-identifier and Sterling's process type. A stress test rejected it, on four grounds:

1. **The containment claim was false by its own signature.** The proposed `resolveFlowPolicy(flow,
   line, order)` takes a singular `order`; a multi-order batch has none. `packGrain` is not a policy
   value — it needs a different screen, an ambiguity-resolution algorithm (one scanned EAN matching
   three orders), and a batch entity with claim/release semantics.
2. **The guard allowlist duplicated the axes.** `requireScanVerification` disabled ≡
   `verificationMode: manual`; and `packingSlip: none` with `requirePackingSlipPrinted` enabled is
   representable and means wait-forever.
3. **No versioning.** Flows carried `name/isDefault/isActive` only, so "which process did this order
   go through" resolved to "whatever flow 7 looks like now" — destroying the auditability that
   justified stamping the id.
4. **`orderType` has no referent** — zero occurrences in `libs/core/src`.

## Decision

Ship the two axes that have a real requirement, as a **validated per-connection config pair** on
`Connection.config` (JSONB, no migration, matching the `stockSafetyBuffer` / `pricingRule`
precedent): `verificationMode` (`manual | scan | scan-where-possible`) and `dispatchGate`
(`off | warn | block`). One pure coercer reads both; they are validated together because they are the
one genuinely dependent pair.

Stages stay **global**, as originally designed.

**Defer** `order_flows`, `OrderFlowResolver`, `order_records.flowId`, `packGrain`, `packingSlip`,
`disabledGuards` and `orderType` to the Wave-2 checkpoint, where the premise — several clients
working measurably differently — is either observed or is not.

**The dispatch gate binds only where OL performs the dispatch.** For `ompFulfilled` (the *default*
routing resolution) and `sourceBrokered`, dispatch happens remotely and OL observes it afterwards, so
`block` is unenforceable. Verification is advisory there, and the UI must say so rather than claim a
guarantee it cannot keep.

## Alternatives considered

- **The `OrderFlow` entity**: rejected for now, per the stress test above. Not wrong in principle —
  wrong ahead of its requirement.
- **Independent unvalidated config keys**: rejected — verification and gate are genuinely dependent.

## Consequences

**Pros:** delivers the adaptability actually asked for; no new entity, no referential-integrity
surface, no versioning obligation, no reporting fragmentation.

**Cons / trade-offs:** per-connection, not per-order — one connection cannot run two processes.
Accepted until observed otherwise.

**If the flow entity returns**, these are preconditions, not follow-ups:
- **Version it, and snapshot the resolved definition onto the order.** For a config this small the
  snapshot is cheap and removes both the retention problem and the dangling-order problem.
- **Refuse destructive edits** to a stage that live orders occupy (commercetools' `ReferenceExists`),
  or require an explicit remap (Camunda's mapping-or-reject).
- Every surveyed platform stamps the selection key at creation and none re-evaluates it mid-order.
  The universally-avoided outcome is an order sitting in a status the config no longer contains.

## References

- Related issues: #1032, #827
- Related ADRs: [ADR-039](./039-order-lifecycle-derived-from-fact-ledger.md), [ADR-012](./012-branch-1-fulfillment-modeling.md)
- Plan: [implementation-plan-1032-oms-module](../../plans/implementation-plan-1032-oms-module.md) § 6K
