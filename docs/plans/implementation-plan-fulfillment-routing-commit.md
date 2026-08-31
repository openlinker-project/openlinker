# Implementation Plan — Fulfilment routing selection, the #2047 four-part gate, and the one-transaction commit (#2395)

> Wave 3a (`W3a-6`), stream S1, epic #2412. Branch `2395-routing-commit`, based on
> `origin/oms-programme-wave-3a` — **not** `main`. PR targets the wave branch.

## 1. Goal

Give OpenLinker the ability to decide **where an order is fulfilled from**, exactly once, and to
persist that decision atomically.

Two routers producing two plans for one order is a **double shipment** — physical and
unrecoverable. Everything below is one correctness argument built around that single failure mode;
this is why #2395 is sized L rather than split (each half is individually safe and jointly permits
the double-ship).

### Non-goals

- **Routing rules.** The named filters/sorts and their coercer are owned by `@openlinker/oms`
  (REVIEW H7, ADR-054 amendment) and live in `oms_routing_rules`. Core keeps only what crosses the port.
- **Consuming `RoutingPlan.pending`.** Declared by #2393 and refused by `assertRoutingPlanResolved`. `W4-3`.
- **The ingestion intercept.** #2396 owns the `none / ambiguous / selected` decision *at ingestion*
  and the persisted outcome. #2395 owns selection, the gate and the commit.
- **Resolving a real router adapter.** See §2 — impossible today by design; #2408/#2409 own it.

## 2. The two facts that shape this slice

### 2.1 No `FulfillmentRouter` adapter exists, and none can be dispatched

`libs/oms/src/oms.plugin.ts` ships `supportedCapabilities: []` and an **empty** `dispatchCapability`
table, with its own docblock recording *"Declared here, injected by #2408/#2409."* Separately,
`'FulfillmentRouter'` is deliberately absent from `CoreCapabilityValues` and from every manifest
(#2393, #2403 — A2 is `config-only`), and that absence is **actively asserted** by a live spec
(`pending-routing-plan-not-supported.error.spec.ts` asserts the source does not contain the name).

Consequently the issue's proposed
`listCapabilityAdapters({ capability: 'FulfillmentRouter', lazy: true })` **cannot work**, and
making it work would mean breaking three guard sites plus a spec and reintroducing the #2085 trap
#2403 rejected by name: `enabledCapabilities` is stamped at connection create and never
retro-filled, so a gate on a newly-added name drains nothing for every install that already exists.

**Therefore:** the router is supplied to core **as an argument**, typed `FulfillmentRouterPort`. The
host-side resolution seam yields "no router" today. The only live production path this slice is the
`none` arm — which is not unfinished work but ADR-054's specified behaviour:

> *"With no router configured the layer is a degenerate pass-through: no work objects, today's path
> byte-identical — the property that survives the Wave-5 kill."*

`selected` and `ambiguous` are fully covered against fakes and become live with #2408/#2409.

### 2.2 `locationHash` has no sound source today — so this slice creates one

`RoutingShipTo`'s degraded arm (`OL_STORE_PII=false`) carries `locationHash`, **caller-supplied and
never derived in core** (#2393). #2399's dispatch handler passes `addressHash: null` with a comment
naming #2395 as the slice that must supply it.

Three candidate sources, two rejected:

- **Recompute from the order snapshot — REJECTED.** Under `OL_STORE_PII=false` the snapshot has
  already been through `redactAddress`, so hashing it yields **one hash per country shared by every
  order in the install**: a plausible 64-hex string that groups everything while looking correct.
  No error, no anomaly.
- **Read the customer's latest `shipping` address projection — REJECTED.** Address projections are
  keyed `(internalCustomerId, addressHash, addressType)` — **by customer, never by order**. There is
  no order→address link. Picking the most recent is correct for a one-address customer and
  **silently wrong** for a customer with two, in a way nothing reports. A router deciding from the
  wrong address ships from the wrong warehouse. This is the same defect as the first option, one
  level down: a plausible-but-wrong grouping key is worse than none.
- **Persist the hash on the order at ingestion — ADOPTED.** A nullable
  `order_records.shippingAddressHash`, written where the un-redacted address is still in hand. This
  is the #1985 denormalization precedent (`placedAt` / `currency` / `taxTreatment`). Order-exact,
  and correct precisely on the hash-only deployments the degraded arm exists to serve.

**A blank or absent hash is treated as absent and never forwarded** — a blank string is itself a
shared grouping key. `buildRoutingShipTo` already enforces this (`||`, not `??`); this slice must
not undo it, and a spec pins it.

## 3. Architecture

### 3.1 Where selection lives, and why not where the issue says

The issue's `File(s)` names `libs/core/src/fulfillment/application/services/`.
**`selectPrimaryFulfillmentRouter` goes to `libs/core/src/fulfillment-authority/domain/types/` instead.**

`barrel-purity.spec.ts`'s `ZERO_SIBLING_EDGE_LEAVES` permits `fulfillment` **type-only** imports
from `fulfillment-authority` — a value import is forbidden unconditionally. So placing the function
in `fulfillment` forces one of two bad outcomes:

- import `selectAuthorityHolder` as a value → the spec fails; or
- re-derive the selection rule locally → two answers to one question, which ADR-053 § Alternatives
  rejects by name, and which would let the read model (A2) and the write gate disagree about who
  routes.

Placed beside `selectAuthorityHolder` it costs **zero new edges** (the leaf's empty allow-set is
untouched — it uses only in-leaf primitives), and it makes the acceptance criterion *"#2351's
`resolveAuthorities` consumes it for A2"* literally implementable in-leaf.

This is the kind of placement a later reader would try to "tidy" back into `fulfillment`; the
docblock must say why not.

### 3.1b Naming — `RoutingCommitService`, NOT `FulfillmentRoutingService` (pre-implement BLOCKING-1)

`IFulfillmentRoutingService` / `FulfillmentRoutingService` **already exist** in
`libs/core/src/mappings` (#832, ADR-012) — exported from that barrel, bound to
`FULFILLMENT_ROUTING_SERVICE_TOKEN`, with five live consumers in `shipping`. They answer *"which
processor or carrier DISPATCHES this?"*; this slice answers *"which location and holder SOURCES
it?"*. `fulfillment-router.port.ts` already warns the two are close and must not be wired together.

This context's service is therefore `IRoutingCommitService` / `RoutingCommitService`, matching its
own `RoutingCommitOutcome`.

### 3.2 Selection is config-driven, not capability-driven

`AUTHORITY_KIND_DESCRIPTORS.sourcing` declares `capability: 'config-only'` and
`owningContext: 'fulfillment'`. Candidates are therefore connections whose `Connection.config`
carries an enabled `sourcingAuthority` claim, coerced by `parseAuthorityConfig` — the same read
`resolveAuthorities` already performs. Requested scope is `global`: routing picks **one** router for
the whole order, so the scope tiering degenerates and the rule reduces exactly to the #2047
invoicing precedent.

### 3.3 Layering

```
apps/worker/src/sync/handlers/fulfillment-work-route.handler.ts   ← composes
  ├── IIntegrationsService      (list connections → claimants)
  ├── selectPrimaryFulfillmentRouter   (@openlinker/core/fulfillment-authority, pure)
  ├── IOrderRecordService       (lines, cancelledAt, shippingAddressHash)
  ├── buildRoutingShipTo        (@openlinker/core/fulfillment, pure)
  └── IRoutingCommitService.route({ …, router })   ← core, argument-fed
```

The handler exists **because core may not resolve any of this**: `fulfillment` is a registered
zero-sibling-edge leaf and ADR-053's no-injection invariant forbids it injecting `orders`,
`customers` or `integrations`. Order data enters as arguments. This is precisely the shape #2399's
`FulfillmentWorkDispatchHandler` already established, and this handler is modelled on it.

## 4. Design

### 4.1 `selectPrimaryFulfillmentRouter` (new, `fulfillment-authority`)

```ts
export type FulfillmentRouterSelectionReason =
  | 'no-claimant'                     // none  — today's pass-through applies
  | 'single-claimant'                 // selected, no primary flag needed (#2047 zero-config property)
  | 'primary-elected'                 // selected among several
  | 'no-primary'                      // ambiguous
  | 'multiple-primaries'              // ambiguous
  | 'multiple-claimants-same-scope';  // ambiguous

export interface FulfillmentRouterSelection {
  readonly holder: string | null;                        // connectionId, null on none/ambiguous
  readonly reason: FulfillmentRouterSelectionReason;      // NEVER null, on every arm
  readonly candidateConnectionIds: readonly string[];
}
```

`{ holder, reason }` on **all three arms** is the Wave-2 §7.1 obligation: the "Who decides what"
surface renders A2 from it, and a null reason degrades that row to *"OpenLinker can't tell"* on
every install that has configured a router.

Pure, total, never throws — a malformed config yields an outcome, matching `selectAuthorityHolder`.

**It folds over CLAIMED SCOPES; it must not issue a single `global` request** (pre-implement
BLOCKING-2). `resolveOneAuthority`'s docblock states the rule verbatim — *"Never a single
`{ kind: 'global' }` request … a `channel`- or `location`-scoped claim would land in neither tier
and resolve to `none` … **Channel-scoped claims are the DESIGNED shape for A2/A5**"* — and A2 is
scope-iterating today.

This was very nearly a silent regression. **No existing assertion would have caught it**: the only
`sourcing` assertions are the zero-config `nobody-to-route` default, which a global-only selection
still satisfies, while every scope-behaviour test (`:242`, the one labelled *"the regression D10
exists for"*, and `:269`) is written against `availability`. A global-only A2 would have reopened
D10 for A2 **with a green suite** — so the earlier mitigation *"stop if an expectation moves"* was
inert, because nothing moves.

So: fold over the scopes actually claimed (the `resolveOneAuthority` shape), collect distinct
holders, and report `ambiguous` when more than one survives. Routing still commits to exactly one
router per order — the fold is how candidates are *found*, not a licence to pick among several. A
spec must cover a channel-scoped sourcing claim resolving to `selected`.

### 4.2 `IRoutingCommitService.route` — the four-part gate

```ts
route(input: {
  orderId; routerConnectionId; lines; shipTo; requestedDeliveryMethod;
  orderCancelledAt: Date | null;
  router: FulfillmentRouterPort;
}): Promise<RoutingCommitOutcome>
```

Ordered, and the order is the correctness argument:

1. **Cancelled-order gate.** `orderCancelledAt !== null` → commit nothing (REVIEW C10). Checked
   inside the lock so a cancellation racing a re-route cannot slip between.
2. **Lock.** `SyncLockPort.acquire('fulfillment:route:{orderId}', FULFILLMENT_ROUTE_LOCK_TTL_MS)`.
   Keyed **per order, not per (order, router)** — the invariant being serialized is *"this order is
   routed once"*, and two operators configuring different routers is exactly the case a
   per-connection key lets through. Same key shape and reasoning as `invoiceIssueLockKey` and
   `shipmentDispatchLockKey`. On failure to acquire: **answer from persisted state only**
   (`findLiveByOrderId` / `findByOrderId`) and return `contended` — the router is never reached
   twice.
3. **Write-path guard (a read, hence the lock).** Refuse when a live decision exists **or**
   non-cancelled work exists for the order — **regardless of router identity**.
4. **Intent before the boundary.** `claimIntent({orderId, routerConnectionId})`, which commits
   **independently** of any caller transaction by design (#2394). `RoutingDecisionAlreadyLiveError`
   → `already-live`. This is the ordering a lock cannot supply: a lock is lost on process death, TTL
   expiry or a Redis blip, and the next holder has no way to learn a `route()` is in flight.
5. **Call the router** with `deriveRouteIdempotencyKey(decision.id)` — mandatory, derived from the
   immutable row id, so a **retry** re-derives byte-identically while a **re-route** is a new row
   and therefore a new key (the #2039 `reconcileId` lesson).
6. **Validate**: `assertRoutingPlanResolved` (`pending` → abandon `plan-pending`) then
   `checkRoutingPlanConservesQuantities` (→ abandon `plan-not-conserving`). A plan that silently
   drops a line is unfulfilled stock with every surface reporting success.
7. **One transaction**: N work rows **+** the decision's terminalisation to `committed`.

**TTL expiry is not a correctness cliff**, for the same reason it is not one in invoicing: the
window the lock must cover is only *guard-read → `claimIntent`*, two DB round-trips. Past that a
`live` decision row exists and a peer's own guard read sees it and refuses. The lock removes the
race; the **persisted intent row** is what survives a lock that expired mid-`route()`. Single-shot,
no heartbeat — there is nothing left for a heartbeat to protect.

**Declared timeout strictly below the lock TTL.** `FULFILLMENT_ROUTE_TIMEOUT_MS` bounds the
`route()` call; a spec asserts `FULFILLMENT_ROUTE_TIMEOUT_MS < FULFILLMENT_ROUTE_LOCK_TTL_MS`. A
router that outruns the lock would otherwise commit work rows while a peer, having acquired the
expired lock, is committing its own. Timeout → abandon `router-timeout`; a throw → `router-failed`.
Both are new members of `RoutingDecisionAbandonReasonValues` — the column is `varchar(64)`, so **no
migration** (#2394 anticipated exactly this).

### 4.3 The transaction seam

`FulfillmentWorkRepositoryPort` gains:

```ts
runInTransaction<T>(fn: (tx: FulfillmentWorkTransaction) => Promise<T>): Promise<T>;
```

#2392 has no way for core to *start* a transaction (only to *join* one), and its docblock says
*"#2395 sits one transition away from wanting the same seam … Widening it is #2395's call."* The
handle stays the opaque `FulfillmentWorkTransaction` — never `EntityManager` — so the port remains
framework-free and an in-memory fake stays typable.

`create(..., tx)` and `terminalise({..., transaction: tx})` both already accept it.

## 5. Steps

### Phase A — selection (pure, `fulfillment-authority`)
1. `domain/types/fulfillment-router-selection.types.ts` + spec. Reason non-null on all three arms.
2. Wire A2 in `resolveAuthorities` to delegate (short-circuit arm, like A6/A7). Existing #2351
   specs must stay green — if any A2 expectation moves, stop and re-derive rather than edit it.
3. Export from the leaf barrel.

### Phase B — the order-side hash (`orders`)
4. Migration `1868000000000-add-order-shipping-address-hash.ts` — nullable `varchar`, plus the ORM
   entity column. **Re-verify the wave tail immediately before pushing** (#2401/#2402 are live).
5. Write it where the un-redacted address is in hand. Confirmed available: `redactAddress` runs
   inside `persistOrder` (`order-record.service.ts:135`), *after* ingestion passes the address
   un-redacted, and `hashAddress`/`normalizeAddress` are importable from `@openlinker/shared/config`.
6. **This column DOES belong in `toOrm`** — unlike `cancelledAt` / `salesDocument*`, it is
   payload-derived and idempotent, not OL-owned single-writer state, so the omit-from-`toOrm`
   precedent does not apply. The raw-SQL upsert tuple (`order-record.repository.ts:1846-1865`) must
   be updated **in lockstep**, and the entity constructor argument appended **last** —
   `order-record.entity.ts:246` warns that positional insertion silently shifts every call site.
7. Extend the migration-parity spec: attempt `TABLES += 'order_records'`; if it fails on
   pre-existing drift (the spec warns of exactly this), fall back to a targeted assertion that the
   column exists in the migration-built schema with the right type and nullability, and say why.

### Phase C — core routing service (`fulfillment`)
8. `runInTransaction` on the port + repository.
9. Two new abandon reasons (`router-timeout`, `router-failed`). `routing-decision.types.spec.ts:34`
   asserts the **exact** array contents and must be updated in the same commit. Column is
   `varchar(64)`, so no migration.
10. `fulfillment-route-lock.ts` (key helper + clamped env TTL + timeout), the
    `invoice-issue-lock.ts` shape.
11. `IRoutingCommitService` + `RoutingCommitService` + outcome types.
12. Bind in `FulfillmentModule`; export token. **Watch for a merge producing two `exports:` keys** —
    valid TypeScript that silently drops the first.

### Phase D — job + handler
13. `fulfillment.work.route` job type + payload type.
14. Worker handler composing selection → order → shipTo → core. Router seam yields `null` today →
    `none` → `ok`, byte-identical pass-through.
15. Register with an ADR-050 lane: **`realtime`** (pre-implement IMPORTANT-3). `bulk` was the
    original choice and the registry argues it down in-tree: *"It outranks the 'core-owned internal
    pass' instinct that would suggest `bulk`, **because that instinct is about who ENQUEUES the job,
    and the lane is about who is hurt when it is late**."* A late route is a late shipment, and both
    sibling fulfilment job types are `realtime`. `assertFullLaneCoverage` fails boot if the lane is
    not declared.

### Phase E — evidence
16. Unit + int specs per §6.

## 6. How each claim is proven

| Claim | Evidence |
|---|---|
| **One-transaction commit is atomic** | Int-spec: a fake router returns a plan whose **second** work row violates a DB constraint. Assert **zero** `fulfillment_works` rows for the order **and** the decision still `live` (not `committed`). **Red-first**: run it with the transaction removed (each `create` on its own) — it must fail by finding row 1 persisted and/or the decision terminalised. A green-on-both-sides test proves nothing. |
| **Lock actually serializes** | Int-spec: an **independent** transaction holds the order's decision row `FOR UPDATE`, then assert the second `route()` **blocks** / returns `contended` without reaching the router (router fake asserts call count 1). A *sequential* two-call test passes against no guard at all and is not evidence. |
| **Ambiguity commits nothing** | `selectPrimaryFulfillmentRouter` returns `holder: null`; handler enqueues/creates nothing; assert zero decisions, zero work rows, and the router fake never called. Silence-and-pick-one is forbidden — a wrong pick is a double-ship. |
| **`none` is byte-identical** | Characterisation int-spec: ingestion with no sourcing claimant produces exactly today's rows; no `routing_decisions`, no `fulfillment_works`. |
| **Crash between intent and `route()`** | Re-run with the same order: `claimIntent` refuses (live row), the retry re-derives the identical key, one plan, one set of work rows. |
| **Timeout < lock TTL** | Direct assertion on the two constants. |
| **Blank hash is absent** | Spec: `shippingAddressHash: ''` and `'   '` both produce `locationHash: null`, never a shared key. |
| **Reason non-null on every arm** | Spec over all three arms. |
| **A2 resolves from this read** | Consuming spec: `resolveAuthorities` A2 answer changes with the claimant set via `selectPrimaryFulfillmentRouter`, not from a default. |

## 7. Risks

- **`order_records` in the parity spec** may fail on pre-existing drift the spec explicitly declines
  to own. Mitigated by the Phase-B step 7 fallback.
- **Migration slot collision.** `check-migration-timestamps` compares against `origin/main` only and
  structurally cannot see a sibling branch. Re-verify at push time, not plan time.
- **`OrderIngestionService` is #2396's file.** The coordinator is holding #2396 until this lands, so
  #2396 inherits rather than races.
- **A2 rewiring could move #2351's expectations.** Treated as a stop-and-re-derive signal, never an
  expectation edit.

## 8. Questions & Assumptions

- **WITHDRAWN** (pre-implement BLOCKING-2): the earlier assumption that `global` was the right
  requested scope was wrong, and wrong in the worst way — it would have passed the whole suite. See
  §4.1: selection folds over claimed scopes.
- **Assumed:** no ADR is required — every decision here applies ADR-041/052/053/054/062 as already
  written; nothing reverses or extends them.
