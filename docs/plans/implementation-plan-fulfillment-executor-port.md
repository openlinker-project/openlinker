# Implementation Plan: `FulfillmentExecutorPort` + `FulfillmentStatusSource` (#2398, `W3a-9`)

**Date**: 2026-08-30
**Status**: Ready for Review
**Estimated Effort**: ~0.5 day
**Issue**: #2398 — Wave 3a (epic #2412), stream S1
**Design of record**: `docs/plans/analysis/DESIGN-oms-authority-model.md` §5.4
**ADRs**: 052 (independently assignable authorities), 053 (vocabulary-leaf posture),
054 (`FulfillmentWork` as the unit of assignment), 055 (OMS as a credentialless
connection plugin — R1 forward-compat rules), 062 (trust posture / allowlist projection)

---

## 1. Task Summary

**Objective**: declare the contract a fulfilment *executor* is called through — request
fulfilment of a work object, request its cancellation — plus the optional
`FulfillmentStatusSource` sub-capability a **polling** vendor is served by.

**Context**: DESIGN §5.4 names three implementer shapes for one port — a 3PL adapter
(API submit + webhook progress), the OL-OMS plugin (auto-accept + pick list), an
enterprise DOMS (3PL shape, richer reject vocabulary). Nothing in core knows which,
which is the whole reason the port exists. #2393 (`FulfillmentRouterPort`) answered
*"where is this sourced from?"*; this answers *"who is doing it, and did they take it?"*.

**Classification**: CORE / Domain. Types, one port, one sub-capability, one pure
fail-closed narrowing helper. **No** ORM entity, **no** migration, **no** repository,
**no** service, **no** module change, **no** DI token.

---

## 2. Scope & Non-Goals

### In scope

- `FulfillmentExecutorPort` — `requestFulfillment` / `requestCancellation`.
- `FulfillmentStatusSource` sub-capability + co-located `isFulfillmentStatusSource`
  guard narrowing by **runtime method probe**.
- The I/O types that cross the port, with an ADR-062 allowlist projection and
  per-arm compile-time `Exclude<>` guards.
- A fail-closed narrowing helper + named error for an unrecognised result status.
- Barrel exports; unit specs.

### Out of scope (owner named)

| Deferred | Owner |
|---|---|
| The accept handshake, `acceptedAt` conditional claim, `assignmentAttempt` counter | #2399 (`W3a-10`) |
| Progress INGESTION (`IFulfillmentProgressService.record`), the `fulfillment` inbound domain, the `fulfillment.work.statusSync` job | #2400 (`W3a-11`) |
| `shipment_lines.fulfillmentWorkId` | #2402 (`W3a-13`) |
| `supportedActions` read model | #2406 |
| Any adapter implementing the port | Wave 3b / `@openlinker/oms` |
| `awaiting_wave` (needs a claim/release entity — the ADR-045 `packGrain` lesson) | named first extension point, unowned |

### Constraints

- **Zero-sibling-edge leaf.** `libs/core/src/__tests__/barrel-purity.spec.ts` fails on any
  non-relative `@openlinker/core/<ctx>` import under `fulfillment/` outside its allow-set.
- **ADR-053 no-injection invariant.** No `orders` / `inventory` service is injected;
  order data enters as arguments. `scripts/check-no-injection-contracts.mjs` scans source
  text and cannot see `ModuleRef.get(TOKEN, { strict: false })` — that idiom is forbidden here.
- **Inline `import { type X }` FAILS barrel purity here (pre-implement W3).** That spec
  classifies the inline form as a **value** import; only statement-level
  `import type { … } from '@openlinker/core/fulfillment-authority';` passes. The repo's
  prevailing style elsewhere is inline, and the failure reads as a "FORBIDDEN VALUE IMPORT"
  on a line the author believes is type-only.
- **ADR-055 R1 forward-compat**: new port-input fields optional and ignorable; union growth
  needs `default:` arms across the boundary, never `never`-exhaustive; sub-capability guards
  narrow by runtime method probe.

---

## 3. Architecture Mapping

**Target layer**: CORE domain — `libs/core/src/fulfillment/domain/`.

**Capability**: `FulfillmentExecutor` — **already** in `CoreCapabilityValues` (#2403 took the
registry from 10 to 12 with `AvailabilityAuthority` and `FulfillmentExecutor`), named by
`AUTHORITY_KIND_DESCRIPTORS['fulfillment-execution'].capability`. **This plan adds no
capability value and edits no manifest.**

This is the deliberate divergence from #2393, and it must be stated in the PR:
`FulfillmentRouter` was kept OUT of `CoreCapabilityValues` because A2 (`sourcing`) is
`config-only`, whereas A3 (`fulfillment-execution`) resolves by narrowing a *dispatched*
adapter, so its name has to be assignable. **But no shipped adapter manifest advertises
`FulfillmentExecutor`**, and both capability-checkbox surfaces intersect the adapter's
advertised list with the core set — so A3 is **not reachable through the UI today**. That
is a reachability gap, not data loss (a hand-rolled `PATCH /connections/:id` round-trips it).

**Existing components reused** (no new allow-set entry spent):

| Reused | From | Why |
|---|---|---|
| `FulfillmentWorkRef` | same leaf (#2391) | already "the ref an executor is handed" |
| `RoutingShipTo` + `buildRoutingShipTo` | same leaf (#2393) | the ADR-062 PII allowlist projection, both arms already guarded |
| `FulfillmentCancellationReason` | `@openlinker/core/fulfillment-authority`, **type-only** | already an authorized allow-set specifier (#2391) |

**Allow-set impact: NONE.** The leaf's two registered specifiers are unchanged and no third
is added. Reusing `RoutingShipTo` rather than declaring a second ship-to shape is what buys
that, and it also means this port opens **no new PII surface**: the arms, the allowlist and
the forbidden-key guards are the ones #2393 already ships.

---

## 4. Design

### 4.1 `fulfillment-execution.types.ts`

```ts
export interface FulfillmentRequestLine {
  readonly workLineId: string;   // FulfillmentWorkLine.id — NOT orderLineId
  readonly productVariantId: string;
  readonly quantity: number;
}

export interface FulfillmentRequest {
  readonly work: FulfillmentWorkRef;
  readonly orderId: string;
  readonly lines: readonly FulfillmentRequestLine[];
  readonly shipTo: RoutingShipTo;
  readonly deliveryMethod: string | null;
  readonly idempotencyKey: string;   // MANDATORY, caller-minted
}

export interface FulfillmentCancellationRequest {
  readonly work: FulfillmentWorkRef;
  readonly reason: FulfillmentCancellationReason;
  readonly idempotencyKey: string;
}

export interface AcceptedFulfillmentRequest {
  readonly status: 'accepted';
  readonly externalWorkId: string | null;
  readonly acceptedAt: Date | null;   // the HOLDER's instant — never new Date()
}

export interface RejectedFulfillmentRequest {
  readonly status: 'rejected';
  readonly reason: string;      // the vendor's own vocabulary, opaque
  readonly blocking: boolean;   // excludes the rejecter from re-sourcing
  readonly detail: string | null;
}

export type FulfillmentRequestResult =
  | AcceptedFulfillmentRequest
  | RejectedFulfillmentRequest;
```

Plus exported allowlists (`FULFILLMENT_REQUEST_ALLOWED_KEYS`,
`FULFILLMENT_REQUEST_LINE_ALLOWED_KEYS`) and a `FULFILLMENT_REQUEST_FORBIDDEN_KEYS`
readability aid, mirroring `routing.types.ts` exactly.

**Design points to carry in docblocks:**

1. **`blocking` is the loop-terminator, not a severity flag.** Without it, re-source plus a
   deterministic sort is an infinite loop *by construction*: the same router, given the same
   candidate set, re-picks the holder that just refused. `blocking: true` excludes the
   rejecter from re-sourcing; `false` means "not this time" and leaves it a candidate.
   Exercised by the re-source loop test in `W3b-6`.
2. **`reason` is OPAQUE, `detail` is prose.** The rejecter knows why; core does not. An
   enterprise DOMS has a richer reject vocabulary than a 3PL and neither is core's to
   enumerate — the `RoutingRuleRef.name` / `RoutingUnfulfillableLine.reason` precedent.
3. **The lines are minimal by ADR-062 Decision 2** — `workLineId`, `productVariantId`,
   `quantity`. No sku, no title, no price: an adapter has `identifierMapping` in its
   `HostServices` bag and resolves what its vendor needs. A domain entity handed to a plugin
   re-opens every field it will ever grow.
4. **`idempotencyKey` is mandatory and caller-minted** — `work:{workId}:{assignmentAttempt}`,
   where `assignmentAttempt` is a persisted monotonic counter incremented only by a
   router-driven re-request and written **before** the outbound call. Never the job-runner
   attempt, which changes on exactly the retries the key must survive (the Amazon MCF
   `sellerFulfillmentOrderId` model). #2399 owns the counter; this file states the contract.
   **The key's GUARANTEE must be stated, not just its format** (tech-review): a repeat under
   the same key must return the ORIGINAL outcome and must never create a second assignment.
   A mandatory field whose replay semantics are unstated is a field an implementer cannot
   honour, and the counter's whole design — incremented by a re-request, never by a retry —
   is meaningless without it.
5. **A holder-reported instant is the HOLDER's, never OL's** (#2336 / #2367 / #2371).
   `acceptedAt` and `observedAt` both describe something that happened in another system OL
   did not witness, so each is `null` when not reported rather than filled with `new Date()`.
6. **`orderId` crosses as the adapter's correlation key.** It is an `ol_order_*` internal id,
   meaningless to a vendor on its own — an adapter maps it to its own reference through the
   `identifierMapping` in its `HostServices` bag. `RoutingInput.orderId` is the precedent.
7. **No `pending` arm.** #2393 declared one for an async DOMS and refused it. Here the issue's
   contract is two arms, and an undeclared third would be invented scope — the fail-closed
   helper below covers an unrecognised status without declaring a shape nothing produces.

### 4.2 The port

```ts
export interface FulfillmentExecutorPort {
  requestFulfillment(req: FulfillmentRequest): Promise<FulfillmentRequestResult>;
  requestCancellation(req: FulfillmentCancellationRequest): Promise<FulfillmentRequestResult>;
}
```

Both return the same result type deliberately: cancelling work a holder has **already
accepted** is a request that holder may refuse (`FulfillmentRequestStatus`'s
`cancellation_rejected`, and ADR-054's whole reason for two axes). A `void` cancellation
would assert compliance the contract cannot obtain.

**Inherited gap, stated so it reads as inherited rather than overlooked** (tech-review):
per-method error unions and wall-clock budgets are `W4-1` / `W4-2`, exactly as #2393 left
them. This port adds no error contract of its own.

### 4.3 The sub-capability

`domain/ports/capabilities/fulfillment-status-source.capability.ts`:

```ts
export interface FulfillmentStatusSource {
  getFulfillmentStatus(workRef: FulfillmentWorkRef): Promise<FulfillmentProgressSnapshot>;
}

export function isFulfillmentStatusSource(
  adapter: FulfillmentExecutorPort,
): adapter is FulfillmentExecutorPort & FulfillmentStatusSource {
  return typeof (adapter as Partial<FulfillmentStatusSource>).getFulfillmentStatus === 'function';
}
```

`FulfillmentProgressSnapshot` and `FulfillmentProgressLine` are declared in
`fulfillment-execution.types.ts`, **not in the `.capability.ts` file** (tech-review):
`engineering-standards.md § Type Definitions in Separate Files` puts types in `*.types.ts`,
and `offer-creator.capability.ts` is the in-tree precedent — it declares the interface plus
its guard and imports its types from `../../types/offer-create.types`.

The snapshot crosses **inbound** from a plugin and nothing in this slice validates it;
#2400 owns progress ingestion, so this shape is not to be read as trusted.

It is **counter-shaped, never per-line statuses** (ADR-054 — "3 of 5 shipped" is not a status):

```ts
export interface FulfillmentProgressLine {
  readonly workLineId: string;
  readonly fulfilledQuantity: number;
  readonly cancelledQuantity: number;
}

export interface FulfillmentProgressSnapshot {
  readonly work: FulfillmentWorkRef;
  readonly externalWorkId: string | null;
  readonly lines: readonly FulfillmentProgressLine[];
  readonly observedAt: Date | null;
}
```

`observedAt` is the **vendor's** instant, `null` when not reported — never `new Date()`. The
progress happened in another system and OL's clock is not a witness to it (the #2336
`declinedAt` / #2367 custody rule).

**The method name collides with a different port, and the probe cannot tell them apart
(pre-implement W2).** `orders`' `FulfillmentStatusReader.getFulfillmentStatus({externalOrderId})`
— a sub-capability of `OrderProcessorManagerPort` — shares this method name exactly. There is
no TypeScript conflict, but a runtime probe tests only that the property is a function, so a
single class implementing both ports and dispatched as the `FulfillmentExecutor` would pass
and then be called with a `FulfillmentWorkRef` where it expects `{externalOrderId}`.
The name is kept (it is the signature in both the issue and DESIGN §5.4, and the hazard needs
one class to implement two ports from two contexts, already a design smell) and the collision
is **named in the capability's own docblock** rather than left to be found at runtime.
`getWorkFulfillmentStatus` is the structurally safer alternative, recorded so it is available
rather than rediscovered if a real adapter ever needs both ports.

**Advertised-without-dispatch**: resolved only by narrowing the dispatched
`FulfillmentExecutor` adapter with this guard, never
`getCapabilityAdapter('FulfillmentStatusSource')` — which passes the manifest gate and then
throws inside `dispatchCapability`, and in the list path aborts the whole listing.

### 4.4 Fail-closed narrowing

`domain/exceptions/unrecognised-fulfillment-request-status.error.ts`:

```ts
export class UnrecognisedFulfillmentRequestResultError extends Error { … }

export function assertFulfillmentRequestResultRecognised(
  result: FulfillmentRequestResult,
): asserts result is FulfillmentRequestResult { … }
```

**Named `…RequestResult…`, not `…RequestStatus…` (pre-implement W1).** The same barrel
already exports `FulfillmentRequestStatus` — the seven-member **negotiation axis**, of which
`accepted` and `rejected` are two. A helper named `assertFulfillmentRequestStatusRecognised`
sitting beside it reads unambiguously as an assertion over that union, which it is not.

**The discriminant nonetheless stays `status: 'accepted' | 'rejected'`, and that is
deliberate**: those are exactly the two `FulfillmentRequestStatus` members #2399 stamps onto
`FulfillmentWork.requestStatus` from this result. Renaming them would hide a correspondence
the handshake depends on. A spec pins the correspondence so an edit to either side breaks
loudly rather than drifting.

**Why this shape and not `assertAccepted`.** #2393 refuses `pending` because it is
*unconsumable*; here `rejected` is a perfectly consumable, expected outcome the caller acts
on by re-sourcing — throwing on it would make the normal path exceptional. What must fail
closed is an **unrecognised** status: a plugin answering some third value would otherwise
reach the `rejected` arm's reads and yield `blocking: undefined`, which is falsy, so the
rejecter is **not** excluded and the re-source loop runs forever — precisely the failure
`blocking` exists to prevent. It tests **positively** for the two known values rather than
against one, the `assertRoutingPlanResolved` rule.

---

## 5. Steps

| # | File | Action | Acceptance |
|---|---|---|---|
| 1 | `domain/types/fulfillment-execution.types.ts` | I/O types + allowlists | `tsc` clean; no new sibling import |
| 2 | `…/fulfillment-execution.types.spec.ts` | `KeysOf<T>` + per-arm `Exclude<>` guards, forbidden-key `Extract<>` aids, allowlist round-trip, source-text forbidden-field scan | red-first per guard |
| 3 | `domain/ports/fulfillment-executor.port.ts` | the port | `tsc` clean |
| 4 | `domain/ports/capabilities/fulfillment-status-source.capability.ts` | sub-capability + probe guard | — |
| 5 | `…/fulfillment-status-source.capability.spec.ts` | guard true on a full adapter; **false on an older-shaped adapter lacking the method** (AC 1) | red-first |
| 6 | `domain/exceptions/unrecognised-fulfillment-request-status.error.ts` | error + assertion | — |
| 7 | `…/unrecognised-fulfillment-request-status.error.spec.ts` | passes both known arms; throws on a third value | red-first |
| 8 | `index.ts` | append 4 export lines | barrel-purity green |

**No** `fulfillment.tokens.ts` edit (nothing to bind) — so the anticipated sibling conflict
there does not arise. `index.ts` remains append-only.

---

## 6. Alternatives Considered

1. **A second ship-to shape for execution.** Rejected: a picker needs the same fields a
   router filters on, and a second projection is a second PII allowlist to keep aligned —
   two guards, two forbidden lists, one drift.
2. **Declare a `pending` arm for an async 3PL.** Rejected as invented scope: the issue names
   two arms, and the fail-closed assertion already refuses an unknown status without a shape
   nothing can produce. Re-admitting it later is additive.
3. **`requestCancellation(): Promise<void>`.** Rejected: it would assert compliance, which is
   exactly what ADR-054's second axis exists to deny.
4. **Widen `isFulfillmentStatusSource` to test manifest membership.** Rejected per ADR-046 /
   ADR-055 §G9: an out-of-tree plugin compiled against an older `libs/core` must degrade,
   not throw; a manifest test would also stop recognising a plugin that declares nothing.

---

## 7. Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| `keyof (A \| B)` is the INTERSECTION → a bare `Extract<>` guard over a discriminated union reads `never`, vacuous and green forever | copy #2393's distributing `KeysOf<T>` + per-arm `Exclude<>`; do not reinvent |
| Allowlist array drifts from the interface | `Exclude<>` makes an unlisted field a `tsc` error; the array is exported as data, so widening is a deliberate two-place edit |
| A declaration with nothing behind it | no manifest entry, no capability value, no mirror pair added. A **port** with no implementer is a contract and is fine; a manifest entry would not be |
| Sibling conflict (#2394 / #2395) | this plan touches no ORM entity, no migration, no repository, no tokens file; only `index.ts` (append-only) is shared |

---

## 8. Testing Strategy

Unit only — there is nothing to integrate yet.

- **Red-first per guard**, and the red must be for the RIGHT reason: a `TS6133`
  unused-import red with `Tests: 0 total` is a false pass. Each compile-time guard is
  proved by temporarily adding the offending field to the interface and observing the
  `tsc` error name the guard's own type alias.
- Every compile-time constant is **referenced in an assertion** so it cannot be
  tree-shaken into irrelevance (`_noUnallowed… === true`).
- AC 1's fake adapter: an object satisfying `FulfillmentExecutorPort` and nothing else.
- AC 2: `blocking` semantics documented on the type, and pinned by a **compile-time
  non-optionality guard** — `undefined extends RejectedFulfillmentRequest['blocking'] ? never
  : true`. A plain field round-trip would assert that object literals work and would pass
  identically if the field were deleted (tech-review); the change that actually matters is
  someone writing `blocking?: boolean`, which reintroduces the falsy-`undefined` infinite
  re-source loop the field exists to prevent. The loop behaviour itself belongs to `W3b-6`
  and is named, not faked.

Run single specs with `pnpm --dir libs/core exec jest --runTestsByPath <file>`.

---

## 9. Questions & Assumptions

**Assumptions**
- `FulfillmentWorkRef` (`{workId, connectionId}`) is what an executor is handed — stated
  verbatim by #2391's own docblock.
- Reusing `RoutingShipTo` is preferable to a new projection (see Alternative 1). If a
  reviewer disagrees the cost is one new type plus its own guards; nothing else moves.
- `FulfillmentProgressSnapshot` carries no negotiation status: #2399 owns the handshake and
  a second, poll-derived answer to "did they accept" would be a rival authority.

**Open**
- Whether `requestCancellation` should carry the lines/quantities of a PARTIAL cancellation.
  Deferred: ADR-054 splits the WORK rather than the order, so a partial cancel is expressible
  as a cancellation of a narrower work object. Stated in the port docblock rather than guessed.

**No ADR is drafted.** ADRs 052/053/054/055/062 already decide everything here; this is their
implementation, and §5.4 is the design of record. Writing a sixth would restate them.

---

## 10. Alignment Checklist

- [x] Hexagonal — domain-layer port + capability only
- [x] CORE/Integration boundary — no adapter, no platform vocabulary
- [x] Existing patterns — `*.capability.ts` + co-located `is*`, `as const` unions, `*.types.ts`
- [x] Idempotency — mandatory caller-minted key, contract stated
- [x] Error handling — one named error, fail-closed, positive test
- [x] Naming + file structure per `engineering-standards.md`
- [x] Zero new allow-set entries; no injection; no migration
- [x] Execution-ready
