# Implementation Plan — Router-filtered destination fan-out (#2397, `W3a-8`)

> Wave 3a (epic #2412), stream S1, size S. Branch `2397-router-filtered-fanout`, PR into
> `oms-programme-wave-3a`.

## 1. Task Summary

`OrderSyncService.syncOrder` fans an ingested order out to **every** active connection whose
adapter supports `OrderProcessorManager`, minus the source. Design §5.5 retains that service
unchanged in intent — destination-mirror creation is a commercial/catalogue act, distinct from
fulfilment assignment — but under a router the fan-out becomes **filtered**.

This slice adds one optional field, `OrderSyncRequest.destinationConnectionIds`, and the filter it
drives. **Absent ⇒ today's behaviour, byte for byte.**

## 2. Scope & Non-Goals

**In scope**

- `OrderSyncRequest.destinationConnectionIds?: readonly string[]` (interface).
- The filter inside `OrderSyncService.resolveDestinations`.
- The three-way branch at `destinations.length === 0`, and its log/exception evidence.
- File-header and `@throws`/`@returns` rationale.
- Characterisation + behaviour specs.

**Explicitly NOT in scope**

- **Calling the router.** Nothing in this slice imports `@openlinker/core/fulfillment`, resolves a
  `FulfillmentRouterPort`, or reads a routing decision. The ids arrive as **caller-supplied data**.
- **Populating the field at ingestion.** `OrderIngestionService` is **not edited by this slice**.
  #2400 owns the `none / ambiguous / selected` decision at ingestion and the cross-context service
  placement that produces these ids. Conflict surface with #2400 is therefore *zero shared file*:
  this slice touches `order-sync.service.ts`, `order-sync.service.interface.ts`,
  `no-order-destinations-available.exception.ts` and the `order-sync` spec; #2400 touches
  `order-ingestion.service.ts`. (Reported to the orchestrator rather than assumed.)
- Any change to `syncStatus` persistence, `fulfillmentState`, or reservations.

## 3. Architecture Mapping

| Concern | Location |
|---|---|
| Request contract | `libs/core/src/orders/application/interfaces/order-sync.service.interface.ts` |
| Filter + branch | `libs/core/src/orders/application/services/order-sync.service.ts` |
| Exception detail | `libs/core/src/orders/domain/exceptions/no-order-destinations-available.exception.ts` |
| Specs | `libs/core/src/orders/application/services/__tests__/order-sync.service.spec.ts` |

Entirely intra-`orders`. **No new cross-context edge**, in either direction — which is what keeps
ADR-053's no-injection invariant free here rather than merely respected. No `ModuleRef.get(…,
{ strict: false })` anywhere; `check-no-injection-contracts.mjs` cannot see that form, and routing
around a gate it cannot see is exactly what the rule exists to stop.

`FulfillmentRouter` is **not** added to `CoreCapabilityValues` (#2403 — A2 is `config-only`).
Nothing here needs to dispatch or discover it.

## 4. Design

### 4.1 The field

```ts
/**
 * Optional routing filter — the destinations a router selected for this order.
 *
 * ABSENT (the default, and every install today) ⇒ unfiltered fan-out …
 * PRESENT ⇒ the fan-out is narrowed to these connection ids.
 * PRESENT AND EMPTY ⇒ the router deliberately selected nobody.
 */
readonly destinationConnectionIds?: readonly string[];
```

Three states, and they must stay three: `undefined` and `[]` are **different answers** and are
never collapsed. That distinction is the whole safety property of ruling 4 below.

### 4.2 `resolveDestinations` — the filter

```ts
private async resolveDestinations(
  sourceConnectionId: string,
  destinationConnectionIds?: readonly string[],
): Promise<Array<{ connectionId: string; adapter: OrderProcessorManagerPort }>>
```

The `listCapabilityAdapters` call is **unchanged** — same single `{ capability:
'OrderProcessorManager' }` argument, so no extra key can narrow the listing behind the filter's
back. Source exclusion is unchanged. The filter is applied **after** both, as a pure `Set`
membership test over the already-resolved list.

`undefined` returns the eligible list untouched — the same array shape, same order, produced by the
same code path.

### 4.3 The three conditions behind `destinations.length === 0`

`listCapabilityAdapters` is active-only, so an empty result now conflates three states. Only one is
a non-event, and the branch must say which:

| # | Condition | Behaviour |
|---|---|---|
| (a) | Nothing configured / all inactive — field **absent** | **Throw**, exactly as today |
| (b) | Field present and `[]` — router chose nobody | `warn` + **return `[]`**, no throw |
| (c) | Field named ids; none resolved (missing / inactive / source) | **Throw**, message naming the unresolved ids |

**(b) does not throw — ruling 1.** `MarketplaceOrderSyncHandler` wraps any throw in
`SyncJobExecutionError`; `isNonRetryableError` consults the **per-plugin** retry-classifier
registry, where a core `orders` exception is registered nowhere and is therefore *retryable*. Each
retry re-runs the whole of `syncOrderFromSource` — a live marketplace `getOrder`, `persistOrder`,
customer identity resolution, projection updates — roughly ten times with backoff, ending in a dead
job whose `lastError` blames connection configuration for what the **router** chose. Loud, and
pointing the wrong way. Returning `[]` instead makes ingestion's `results.map(...)` a no-op: no
`syncStatus` row is written and nothing downstream breaks. This matches the file's own philosophy —
`skipped_cancelled` and `skipped_held` exist precisely so that "nothing went wrong" cannot be
routed into a retry.

**(a) keeps its throw unchanged — ruling 1's second half.** That one really is a misconfiguration
and stays exactly as loud as it is today.

**(c) throws, and is a recorded regression — ruling 3.** Today an order whose `dest-a` is disabled
still fans out to `dest-b`/`dest-c`; under a filter naming only `dest-a` it becomes a **total
failure**. It is *not* covered by ruling 1's no-throw, which is scoped to a *deliberate* empty
decision: here the router asked for a destination and OpenLinker could not reach it. A throw is the
honest expression of that, and the retry that follows is *appropriate* for a momentarily-disabled
connection — the condition can genuinely clear. What the current exception cannot do is say which
of (a)/(c) happened, so it gains an optional third constructor argument carrying the unresolved
ids, and its message names them.

**Recommendation to the orchestrator:** (c) warrants its own follow-up issue — an operator-facing
surface for "this order was routed to a connection that is not currently reachable" belongs with the
routing-attention work, not here. Flagged for filing; not filed unilaterally.

### 4.4 Degrade to unfiltered, never to filtered-empty — ruling 4

A missing router, a missing decision, or an unresolvable one must produce an **absent** field, not
an empty array. The branch carries this comment verbatim:

> A caller with no routing answer must omit this field, never pass `[]`. `undefined` degrades to the
> unfiltered fan-out every install has today; `[]` is a router that positively selected nobody. Get
> that backwards and provisioning silently stops on every install that exists.
>
> Note the deliberate asymmetry with #2393's `assertRoutingPlanResolved`, which *raises* on an
> **unrecognised** plan status: that is a programming error. An **absent** router is the normal
> state — the state of every install today — and must pass straight through.

### 4.5 Log evidence — ruling 6

A narrowed fan-out is never silent:

- **(b)** `warn`: the routing decision named no destination; no provisioning, no `syncStatus` rows.
- **partial narrowing** (`filtered.length !== eligible.length`) — `warn` naming the requested count,
  the resolved count, and any requested id that did not resolve. Without this an operator cannot
  tell a working router from a broken connection.
- **(c)** the exception message names the unresolved ids.

Docblocks on `syncOrder` (interface and impl) are corrected: a `@throws` that no longer always
throws is a false statement in a file three later issues read. `@returns` gains the empty-array case.

## 5. Steps

0. **Characterisation test first**, against unmodified code — see §8. Must pass **before** any
   production edit.
1. Add the field to `OrderSyncRequest` (type only, no behaviour).
2. Write the behaviour specs — they go **red with real assertion failures**, not a compile error.
3. Implement the filter, the three-way branch, the logs, the exception argument.
4. Docblocks + file header rationale.
5. Gates.

Step 1 precedes step 2 deliberately: writing a spec that references a field the type lacks makes
ts-jest fail to compile, which reports `Tests: 0 total` — a **false red** that proves nothing.

## 6. Alternatives Considered

- **Let `[]` fall through to the existing throw.** Rejected — ruling 1; traced retry-storm cost above.
- **A `skipped_not_routed` result arm per filtered destination.** Rejected: the issue's AC is that a
  filtered destination gets **no `syncStatus[]` entry**. Emitting one would write rows asserting a
  destination was considered when routing decided it never was.
- **Resolve the router inside `OrderSyncService`.** Rejected: creates the `orders → fulfillment`
  runtime edge, duplicates #2400's decision logic, and makes this service reinterpret rather than
  retain (design §5.5).
- **Narrow the `listCapabilityAdapters` call by id.** Rejected: it takes no such key, and adding one
  would move the filter below the capability gate where its three conditions become indistinguishable.

## 7. Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| A caller passes `[]` meaning "unknown" | §4.4 comment + docblock; `[]` documented as positive selection |
| (c) total-failure regression | Recorded in code comment, plan and PR; follow-up recommended |
| Duplicate ids in the input | `Set` membership — idempotent, no duplicate fan-out |
| An id naming the source connection | Source exclusion runs **first**; such an id simply never matches |

## 8. Testing Strategy

Unit only — no schema, no adapter, no HTTP. Existing integration coverage exercises the
absent-field path unchanged.

**Characterisation (ruling 5) — written and passing before the change:**

- `listCapabilityAdapters` is called **exactly once**, with an argument having **exactly one key**,
  `capability: 'OrderProcessorManager'`.
- The `createOrder` payload is captured and asserted **deep-equal** across an unmodified run and the
  post-change absent-field run — byte-identical, not merely "still succeeds".

**New behaviour cases:** filtered subset; `[]` ⇒ `[]` + no `createOrder` + no throw; unresolved id ⇒
throw naming it; partial narrowing ⇒ warn; duplicate ids; id equal to source.

**The evidence that matters is that no existing spec case is modified.** The diff stat for
`order-sync.service.spec.ts` will be reported as pure additions.

## 9. Questions & Assumptions

- **Assumption:** #2400 owns populating the field. If that boundary shifts, report rather than guess.
- **Open:** whether (c) gets its own follow-up issue — recommended above, orchestrator to file.

## 10. Alignment Checklist

- [x] Hexagonal: application layer only, no port/adapter change
- [x] No new cross-context edge; ADR-053 direction preserved
- [x] `FulfillmentRouter` not added to `CoreCapabilityValues` (#2403)
- [x] Backward compatible by construction (optional field, absent ⇒ today)
- [x] `as const`/union conventions untouched
- [x] Tests added; no existing case modified

---

## 11. Amendment after `/pre-implement` (GO-WITH-CHANGES) and `/tech-review` of this plan

No BLOCKING finding. Both gates independently found the same defect in §4.3, corrected here.

### A1 — §4.3(b) claimed too much, and was wrong (IMPORTANT, both gates)

§4.3 said returning `[]` means "nothing downstream breaks". **That is false.** Ingestion already
adjudicated the opposite for #2339 (`order-ingestion.service.ts:553-566`): writing NOTHING is
*"the worst of the four … the order would render 'No destinations' on `/orders`, denying that the
destinations exist at all"*, and `apps/web/src/features/orders/lib/order-health.ts:143,163`
confirms `rollup.total === 0 → 'unknown' → "No destinations"`.

The corrected claim, which is what §4.3 now asserts: returning `[]` writes **no `syncStatus` row**,
which is exactly what the issue's acceptance criterion requires of a filtered destination — and the
**consequence** is that a routed-to-nobody order is, on `/orders` today, indistinguishable from one
with nothing configured. That is a real operator-facing cost of ruling 1, not a reason to revisit
it: ruling 1 governs the *service*, and the operator surface is downstream.

**This does not change the implementation.** `[]` is returned, as ruled.

### A2 — condition (b) needs a follow-up on the same footing as (c)

(a) and (b) are distinguishable **at the branch** (ruling 2 satisfied) but become
**indistinguishable on `/orders`** — both yield an empty `syncStatus` and the identical `unknown` /
"No destinations" bucket. **Recommended to the orchestrator for filing**, together with the (c)
follow-up from §4.3.

### A3 — ingestion-side evidence is required, and widens the file surface

The sole evidence for (b) was a worker `warn`. One spec is added to the **ingestion** spec asserting
that `results === []` is a genuine no-op: `Promise.allSettled([])` writes no `syncStatus`, and the
downstream `autoIssueTrigger` block still runs.

**This widens §2's "zero shared file with #2400" claim** — that claim held for production files and
still does (#2400 edits `order-ingestion.service.ts`; this slice does not). It no longer holds for
`order-ingestion.service.spec.ts`. The addition is append-only. Disclosed rather than dropped,
because it is the only place the required evidence can be asserted.

### A4 — the exception's docblock describes a mechanism that does not exist

`no-order-destinations-available.exception.ts:6-7` already claims *"the allowlist override points at
a missing connection"*. There is **no allowlist anywhere in `orders`** — the clause is fiction that
happens to describe what this slice builds. It is corrected in this slice, or the file would carry
two descriptions of one mechanism beside a third argument meaning a third thing. The new third
constructor argument is exposed as a `public readonly` field, not merely interpolated.

### A5 — a source-echo id must not be reported as unreachable (SUGGESTION)

Source exclusion runs **before** the filter, so a router naming the source connection falls into (c)
and would be reported as "unresolved" — telling an operator a connection is unreachable when the
router in fact named the source. The unresolved set therefore **excludes ids equal to
`sourceConnectionId`**, which are reported separately as a source echo.

### A6 — the (b) early return precedes the cancellation and hold re-reads (§7 risk)

The `[]` return sits above both the `#2284` cancellation re-read and the `#2339` hold re-read, so
neither `skipped_cancelled` nor `skipped_held` is emitted for a routed-to-nobody order. This is
correct — there is no destination to skip, and both arms are *per destination* — but it is recorded
so a later reader does not mistake it for a dropped gate.
