# ADR-041: Order flows as named operator-process configuration

- **Status**: Proposed
- **Date**: 2026-08-13
- **Authors**: @piotrswierzy

## Context

The OMS operator workbench must adapt to different warehouse processes. Three concrete axes surfaced
immediately: whether pack verification is by barcode scan or a manual tick (a catalogue with missing
EANs cannot be fully scanned), whether an unverified order may still dispatch, and whether packers
work one order at a time or batch several. More will follow — packing slips, stage vocabulary, which
gates apply.

The obvious implementation is a set of independent per-connection settings. The market's cautionary
tale argues against it: BaseLinker made order handling broadly configurable and then had to introduce
*Status Groups* and *action groups* purely to keep the configuration manageable. Unbounded flexibility
becomes its own administration problem.

Meanwhile the enterprise OMS tier converged on a different shape. Fluent Commerce makes `orderType`
**part of the workflow identifier** used at orchestration time; IBM Sterling does the same under
*process type*. An order does not run "the" workflow — it runs *its* workflow.

OpenLinker already has the resolution shape in `FulfillmentRoutingService`, which resolves
`processorKind` from `(sourceConnectionId, sourceDeliveryMethodId)` with a `'rule' | 'default'`
provenance.

## Decision

Introduce **`OrderFlow`** — a named, operator-defined bundle of process configuration, owning the
stage pipeline plus the policy axes (verification mode, dispatch gate, packing slip, pack grain).
An order is **assigned a flow at ingestion** and the id is stamped on `order_records`, resolved by a
rule service mirroring `FulfillmentRoutingService`'s shape and provenance, with a default flow so
nothing needs configuring to work.

A flow may only disable invariants from a **fixed, enumerated list of named guards** (Vendure's
`configureDefaultOrderProcess` pattern). Everything else is non-negotiable: the canonical lifecycle
axis and its precedence, the guardrails (idempotency, monotonicity, relay obligations), the identity
constraints, and the counter validation ladder.

A flow governs **how an operator moves through the work**. It never changes **what OL believes
happened**.

## Alternatives considered

- **Independent per-connection settings**: rejected — the axes are not independent (a catalogue
  without EANs implies both a verification mode *and* a gate policy), and N booleans have no name, no
  audit, and no way to say "this client works like that client".
- **One global process, configured per installation**: rejected — an agency runs several clients on
  one deployment, which is the actual demand.
- **Fully operator-authored workflows (BaseLinker's model)**: rejected — it is the configuration-
  management problem above, and it would put the canonical axis under operator control, which
  [ADR-039](./039-order-lifecycle-derived-from-fact-ledger.md) exists to prevent.

## Consequences

**Pros:**
- One named thing to reason about, report on and copy between clients.
- The guarded core stays guarded; flexibility is bounded by an explicit list.
- Reuses an existing resolution pattern rather than inventing one.

**Cons / trade-offs:**
- **Multiplies the test matrix** — mitigated by making flow a pure *input* to policy resolution rather
  than a code-path branch, so behaviour is tested once and resolution is tested per axis.
- A configuration surface someone must design UI for.
- Much cheaper designed in at Wave 2 than retrofitted later.

**Migration path:**
- One seeded default flow reproducing today's behaviour; `order_records.flowId` nullable, resolved
  lazily, so existing orders are unaffected.

## References

- Related issues: #1032, #827
- Related ADRs: [ADR-039](./039-order-lifecycle-derived-from-fact-ledger.md), [ADR-012](./012-branch-1-fulfillment-modeling.md)
- Plan: [implementation-plan-1032-oms-module](../../plans/implementation-plan-1032-oms-module.md) § 6K
