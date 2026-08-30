# Pre-implement gate: `FulfillmentExecutorPort` + `FulfillmentStatusSource` (#2398)

**Date**: 2026-08-30
**Plan**: `docs/plans/implementation-plan-fulfillment-executor-port.md`
**Scope**: read-only. No source and no plan file was edited by this gate.

## Verdict: **NEEDS-REVISION**

No Critical contract break and no reuse collision. Three **Warnings**, two of which are
naming hazards the plan as written would have shipped, and one an implementation
constraint the plan did not state. All three are fixable inside the plan's own scope —
no artifact moves, nothing is descoped.

---

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `FulfillmentExecutorPort` | **NEW** — confirmed absent | no `*Port` under `libs/core/src/**/domain/ports/**` covers "request fulfilment of work / request its cancellation" |
| `FulfillmentStatusSource` + `isFulfillmentStatusSource` | **NEW** | `'FulfillmentStatusSource'` appears in **no** `.ts` file in the repo |
| All 16 planned exported symbols | **NEW** | every name occurs only in `docs/plans/**` and `docs/architecture/adrs/054-*`; zero `.ts` collisions |
| `domain/ports/capabilities/` directory | **NEW** | `fulfillment/domain/ports/` holds exactly `fulfillment-router.port.ts` + `fulfillment-work-repository.port.ts` |
| `FulfillmentWorkRef` reuse | **EXISTS → reuse** | `domain/types/fulfillment-work.types.ts:49` — `{workId, connectionId}`, as assumed |
| `RoutingShipTo` reuse | **EXISTS → reuse** | `domain/types/routing-ship-to.types.ts`; same leaf, no allow-set cost |
| `FulfillmentCancellationReason` type-only import | **EXISTS → reuse** | already an authorized allow-set specifier for this leaf |
| `'FulfillmentExecutor'` in `CoreCapabilityValues` | **EXISTS** | `libs/core/src/integrations/domain/types/adapter.types.ts:76` — plan's assumption **confirmed** |
| No manifest advertises `FulfillmentExecutor` | **CONFIRMED** | zero `supportedCapabilities` hits repo-wide — plan's reachability caveat is accurate |
| New DI token | **NOT NEEDED** — plan correctly adds none | `fulfillment.tokens.ts` untouched ⇒ **the anticipated sibling conflict with #2394/#2395 does not arise** |

`assignmentAttempt` already exists on `FulfillmentWork` (`fulfillment-work.types.ts:122-135`)
and its docblock *already names* `FulfillmentRequest.idempotencyKey` =
`work:{workId}:{assignmentAttempt}`. The plan's key format is therefore not a proposal — it
is the shape #2391 already committed to, and this port must match it verbatim.

---

## Backward-compatibility findings

| Surface | Result |
|---|---|
| Top-level barrel `@openlinker/core/fulfillment` | **Additive only** — 4 new `export *` lines appended; nothing removed or renamed |
| Port method signatures | No existing port touched |
| DTO shapes | None involved |
| Symbol tokens | None added, none changed |
| ORM schema / migration | **None** — no entity, no column, no migration |
| `check-no-injection-contracts.mjs` | **Safe.** Its `forbidden` list for this leaf is exactly `['@openlinker/core/orders', '@openlinker/core/inventory']` (exact-specifier match). The planned files import neither. Note type-only does **not** exempt — the guard's own self-check pins that — so neither may be reached for later. |
| `barrel-purity.spec.ts` | **Safe with a caveat — see W3.** Relative imports are skipped entirely; `@openlinker/core/fulfillment-authority` is already in this leaf's allow-set, so a type-only import of it needs no table edit. |
| `check-core-capability-mirror` / `check-authority-kind-mirror` | Untouched — no capability value added |

**No Critical items.**

---

## Warnings (all must be addressed before implementing)

### W1 — `FulfillmentRequestStatus` already exists on the same barrel, and the plan's helper name collides with it semantically

`libs/core/src/fulfillment/domain/types/fulfillment-request-status.types.ts:25` exports
`FulfillmentRequestStatus` — the **negotiation axis**, seven members including `accepted`
and `rejected`. The plan names its fail-closed helper
`assertFulfillmentRequestStatusRecognised` and its error
`UnrecognisedFulfillmentRequestStatusError`. Both land on the *same barrel* as that union
and read unambiguously as assertions **over it**, which they are not — they narrow
`FulfillmentRequestResult`.

**Required change**: rename to `assertFulfillmentRequestResultRecognised` and
`UnrecognisedFulfillmentRequestResultError`.

**Explicitly NOT changed**: the discriminant stays `status`, and its two values stay
`'accepted'` / `'rejected'`. That is not an accident to be tidied away — those are exactly
the two `FulfillmentRequestStatus` members #2399 will stamp onto
`FulfillmentWork.requestStatus` from this result, and renaming them would hide a
correspondence the handshake depends on. The docblock must state the relationship, and the
correspondence should be pinned by a spec so a later edit to either side breaks loudly.

### W2 — the sub-capability's method name is already used by a *different* port, and a runtime method probe cannot tell them apart

`libs/core/src/orders/domain/ports/capabilities/fulfillment-status-reader.capability.ts:31`
declares `FulfillmentStatusReader.getFulfillmentStatus(input: { externalOrderId: string })`
— a sub-capability of `OrderProcessorManagerPort`, keyed by external **order** id, returning
a status-shaped `FulfillmentStatusSnapshot`.

The planned `FulfillmentStatusSource.getFulfillmentStatus(workRef: FulfillmentWorkRef)`
shares that method name exactly. There is no TypeScript conflict (different interfaces,
different contexts), but `isFulfillmentStatusSource` narrows by **runtime method probe** —
it tests only that the property is a function. A single adapter class implementing both
ports and dispatched as the `FulfillmentExecutor` would pass the probe and then be called
with a `FulfillmentWorkRef` where it expects `{externalOrderId}`.

**Decision — keep the name, document the hazard.** `getFulfillmentStatus(workRef)` is the
signature in the issue *and* in DESIGN §5.4, and diverging from the design of record on a
naming point needs stronger cause than a hypothetical. The hazard also requires one class
to implement two ports from two contexts, which is already a design smell. But the
collision must be **named in the capability's own docblock** rather than left for the first
implementer to discover at runtime — a guard whose failure mode is invisible is exactly
what ADR-055's probe rule exists to bound, and here the probe has a known blind spot.

Rejected alternative: renaming to `getWorkFulfillmentStatus`. It is structurally safer and
should be reconsidered if a real adapter ever needs both ports; recorded here so that
choice is available rather than rediscovered.

### W3 — inline `import { type X }` FAILS barrel purity in this leaf; only statement-level `import type` passes

`barrel-purity.spec.ts` classifies the inline form as a **value** import and fails it, while
the repo's prevailing style elsewhere is inline. Every cross-context import in the new files
must be written `import type { … } from '@openlinker/core/fulfillment-authority';`.

The plan did not state this. It is a one-line constraint with a silent, confusing failure
mode (a red barrel-purity spec that names a "FORBIDDEN VALUE IMPORT" for a line the author
believes is type-only).

---

## Open questions (non-blocking)

1. **`FulfillmentRequestLine.workLineId` names `FulfillmentWorkLine.id`**, whose own field is
   just `id`. The plan's name is the better one at this boundary (it disambiguates from
   `orderLineId`, which also exists on that shape) but the docblock must say which field it
   refers to, or an implementer will look for a `workLineId` on the work line and not find one.
2. **Partial cancellation** stays deferred, as the plan says. `FulfillmentWork.version` exists
   (optimistic concurrency, #2406's token) and is deliberately *not* carried on the request —
   worth one sentence in the port docblock so its absence reads as a decision.

---

## What to do next

Apply W1, W2 and W3 to the plan, then implement. None of them changes the artifact set, the
file layout, the allow-set cost (still **zero** new entries) or the test strategy.
