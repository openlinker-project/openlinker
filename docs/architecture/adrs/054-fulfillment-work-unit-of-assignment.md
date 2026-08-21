# ADR-054: `FulfillmentWork` as the unit of assignment; config for pre-existing scopes, handshake for flow-created objects

- **Status**: Proposed
- **Date**: 2026-08-21
- **Authors**: @piotrswierzy

## Context

Sourcing needs a unit that can be offered to a fulfiller, accepted or rejected, held, and
re-sourced. OL cannot split a commercial order: `identifier_mappings` is a bijection per connection
([ADR-044](./044-order-changeset-proposed-then-confirmed.md)), so a split child is unmappable on
its origin and a marketplace cancel would leave it live and shippable. ANALYSIS-1032 killed Wave 5
because its mechanism did not apply to `omp_fulfilled` — the default routing kind, where OL never
dispatches.

## Decision

Introduce **`FulfillmentWork`** in a new core `fulfillment` context: an order's line-quantities per
(location, delivery method), N:1 to the order, 1:N to shipments, with **two orthogonal state axes**
(execution `open…closed/cancelled/incomplete` × negotiation `unsubmitted…accepted/rejected/
cancellation_*`), line **quantity counters** (never per-line statuses), first-class hold rows, and
`supportedActions` computed server-side on the read model. **Splits exist only at this grain.**
Authority grant rule: an authority whose scope exists before any order is **config**
(`Connection.config.*`, coerced); execution authority over a flow-created work object is a
**handshake** — accept via conditional claim (`WHERE acceptedAt IS NULL`), reject with
`{reason, blocking}` (blocking excludes the rejecter from re-sourcing), timeout-as-rejection by
sweep. Revocation is **prospective-only**; in-flight work is taken back by negotiated cancel or an
audited operator force-close to `cancelled` (reason `operator_forced` — a member of the declared
union; a disabled holder cannot be resolved for negotiation, so force-close is that case's exit).
With no router configured the layer is a degenerate
pass-through: no work objects, today's path byte-identical — the property that survives the Wave-5
kill.

R1 amendments (panel review): a `routing_decisions` **intent row is persisted before the
committing `route()`** (partial-unique on the live decision; the guard reads it regardless of
router identity; route key derived from it; N work rows + terminalisation in one transaction) —
the #2047 persist-intent-before-the-boundary ordering the lock alone cannot supply. Every
`fulfillment_works` column has a named owner and a conditional-UPDATE transition; line counters
carry `CHECK (fulfilled + cancelled ≤ total)`; `supportedActions` is actionable only with an
optimistic-concurrency token (stale ⇒ 409 + refreshed set). `assignmentAttempt` is a persisted
monotonic counter on the work row (never the job-runner attempt). Progress is **inbound**:
ingestion is the core-side `IFulfillmentProgressService.record(event)` reached through the
webhook ingress (`'fulfillment'` joins `InboundEventDomainValues`; routing-policy arm gated on
`FulfillmentExecutor`; `fulfillment.work.statusSync` as webhook-as-trigger/authoritative-pull);
polling vendors implement the pull-shaped `FulfillmentStatusSource` sub-capability instead. The
named routing filters/sorts and their coercer are **owned by the OL-OMS plugin** — core keeps
only `RoutingInput`/`RoutingPlan` (with a `pending {decisionId}` arm for async DOMS sourcing) /
`RoutingExplanationStep` with opaque rule names.

## Alternatives considered

- **Split the order**: structurally impossible (bijection) and manufactures a
  ship-a-cancelled-order bug. Forbidden, not deferred.
- **One merged state axis**: yields "cancel is a command"; cancelling accepted work is a
  negotiation (Shopify's `requestStatus`), and the split mirrors ADR-007's status-vs-outcome rule.
- **Method-per-state executor port** (`markPicked`, …): rejected per
  [ADR-027](./027-order-status-writeback-capability-and-relay.md) — widens every adapter per state;
  unsupported states become silent no-ops. Progress is event-as-data through one `report(event)`.
- **Router on by default**: makes the `omp_fulfilled` majority pay for a decision they never asked
  for — the Wave-5 failure mode.

## Consequences

**Pros:**
- Splits, holds, re-sourcing and partial fulfilment become expressible with the commercial order
  untouched.
- One handshake serves the OL-OMS plugin, 3PL adapters and enterprise DOMS adapters.

**Cons / trade-offs:**
- A second "routing" vocabulary exists beside the shipping layer's dispatch resolution
  ([ADR-012](./012-branch-1-fulfillment-modeling.md)); documented as *sourcing* vs
  *dispatch resolution*, and the shipping layer stays authoritative for label mechanics.
- Observation-only work on `omp_fulfilled` closes coarsely (whole-order observed dispatch).

*Reversal gate (prose-only):* an operator demonstrably outgrowing the ordered filter/sort list (needing
cross-rule conditions or arbitrary predicates) re-opens the no-rules-engine decision; a second
executor needing batching re-opens the `awaiting_wave` deferral.

## References

- Related issues: #1032, #1917
- Related ADRs: [ADR-007](./007-syncjob-status-vs-outcome-split.md), [ADR-012](./012-branch-1-fulfillment-modeling.md), [ADR-020](./020-neutral-delivery-intent-shipping-dispatch.md), [ADR-027](./027-order-status-writeback-capability-and-relay.md), [ADR-044](./044-order-changeset-proposed-then-confirmed.md)
- Design doc: [DESIGN-oms-authority-model](../../plans/analysis/DESIGN-oms-authority-model.md) §5
