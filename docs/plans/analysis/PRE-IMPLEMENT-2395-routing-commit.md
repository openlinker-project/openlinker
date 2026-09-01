# Pre-Implement Readiness Gate — #2395 Fulfilment routing selection + one-transaction commit

**Plan:** `docs/plans/implementation-plan-fulfillment-routing-commit.md`
**Branch:** `2395-routing-commit` (base `origin/oms-programme-wave-3a`, HEAD `bbc2134d3`)
**Mode:** read-only. No source file modified.

## Verdict: **GO-WITH-CHANGES**

The plan's core correctness argument (lock → intent → router → validate → one transaction) is sound
and lands on real, already-shipped seams. Three findings must be resolved before coding: a hard
**name collision** with a shipped, exported `IFulfillmentRoutingService` in `mappings`; an **A2
rewiring that contradicts a documented shipped invariant** (`resolveOneAuthority`'s "Never a single
`{kind:'global'}` request"); and a **lane choice the repo already argues against in a comment on the
sibling job type**. None is fatal to the design — each is a naming/scope correction.

---

## Findings

### 1. BLOCKING — `IFulfillmentRoutingService` / `FulfillmentRoutingService` already exist and are exported

Plan §4.2 / Step 11 creates `IFulfillmentRoutingService` + `FulfillmentRoutingService` in
`fulfillment`. Both names are **already taken**, in `mappings`, for a different concept (#832 /
ADR-012 — routing an order's `(source, delivery method)` to a destination processor):

- `libs/core/src/mappings/application/interfaces/fulfillment-routing.service.interface.ts:20`
  `export interface IFulfillmentRoutingService {`
- `libs/core/src/mappings/application/services/fulfillment-routing.service.ts:57`
  `export class FulfillmentRoutingService implements IFulfillmentRoutingService {`
- `libs/core/src/mappings/index.ts:44` — exported from the `@openlinker/core/mappings` barrel.
- `libs/core/src/mappings/mappings.tokens.ts:18`
  `export const FULFILLMENT_ROUTING_SERVICE_TOKEN = Symbol('IFulfillmentRoutingService');`

It has **five live consumers** that would now be reading an ambiguous name:
`shipping/application/services/shipment-dispatch.service.ts:28,87`,
`shipping/application/services/fulfillment-status-sync.service.ts:52,174`, plus their specs.
`libs/core/src/fulfillment/domain/ports/fulfillment-router.port.ts:10` already names
`IFulfillmentRoutingService` in a docblock — from #2393, i.e. the collision was half-anticipated and
not resolved.

Two contexts owning two differently-shaped `IFulfillmentRoutingService` and two
`FULFILLMENT_ROUTING_SERVICE_TOKEN`-shaped tokens is exactly the "two answers to one question"
the plan itself rejects one section earlier.

**Required:** rename the new pair. `IRoutingCommitService` / `RoutingCommitService` (matching the
already-declared `RoutingCommitOutcome` in the plan, and the issue's own title) is the obvious fit;
token `ROUTING_COMMIT_SERVICE_TOKEN`. Whatever is chosen, its docblock must name the `mappings`
service and say they are unrelated — the shipped precedent for this is
`handler-registration.service.ts:198`, which does exactly that for `marketplace.fulfillment.statusSync`
vs `fulfillment.work.statusSync` ("shares nothing with this but a word").

### 2. BLOCKING — the A2 rewiring contradicts a shipped, documented invariant

Plan §3.2 and §8 assume `global` is the right requested scope for A2 selection. The shipped code
says the opposite, by name:

`libs/core/src/fulfillment-authority/domain/types/authority-resolution.types.ts` (docblock above
`resolveOneAuthority`):

> *"Resolve one authority across every scope it is claimed over, and fold. **Never a single
> `{ kind: 'global' }` request.** `selectAuthorityHolder` keeps only claims covering the requested
> scope … So a `channel`- or `location`-scoped claim would land in neither tier and resolve to
> `none`, and the page built to show an operator their configuration would report "nobody claims
> this" about a claim that exists. **Channel-scoped claims are the DESIGNED shape for A2/A5**
> (DESIGN §2.1) … so that is the common case, not a corner."*

The current A2 behaviour **is** scope-iterating: `resolveOneAuthority` builds `scopesByKey` and calls
`selectAuthorityHolder(candidates, scope)` once per distinct claimed scope
(`authority-resolution.types.ts`, the `for (const scope of scopesByKey.values())` loop), folding into
`{kind:'holders', holders:[…]}`.

**Which existing assertions change — precisely:**

- **No currently-passing assertion breaks mechanically.** The only `sourcing` assertions in
  `authority-resolution.types.spec.ts` are the zero-config default arm —
  `:62 expect(rowFor(rows,'sourcing').answer).toEqual({ kind: 'nobody-to-route' })` and
  `:75 expect(rowFor(rows,'sourcing').state).toBe('default')` — which a global-only selection still
  satisfies. `:111 'should change no behaviour — every other row is identical to the zero-config run'`
  also still passes (its claimants claim `availability` only).
- **That is the hazard, not the reassurance.** Every scope-behaviour test in that file is written
  against `availability` (A1), not `sourcing`: `:242 'should honour a SCOPED claim rather than
  reporting the default'` (explicitly labelled *"The regression D10 exists for: resolving once at
  `global` discards every narrower claim, and the surface reports 'nobody claims this' about a claim
  that exists"*) and `:269 'should fold two disjoint scopes into one routine compound answer'`. So
  short-circuiting A2 to a global-only path **reintroduces regression D10 for A2 specifically, with
  zero test coverage and a green suite** — while A2 is, per the docblock, the kind for which
  channel-scoped claims are the designed shape.

**Required — one of:**
(a) Keep `resolveAuthorities`' A2 arm exactly as it is (scope-iterating) and let
`selectPrimaryFulfillmentRouter` be a *separate* write-path selector used only by the routing
commit, documenting that A2's read model and the routing gate answer different questions
(*"who claims sourcing, per scope"* vs *"which single router routes THIS order"*). This loses the
plan's "one answer to one question" property, so it must be argued explicitly; **or**
(b) Have `selectPrimaryFulfillmentRouter` itself fold over claimed scopes (reusing
`resolveOneAuthority`'s loop shape) and refuse — `ambiguous` — when more than one distinct holder
survives the fold, then delegate A2 to it. This preserves both the invariant and the single-source
property, and is the recommended route.

Either way, add a **new** `sourcing`-specific scoped-claim spec mirroring `:242`. Plan §7's
"stop-and-re-derive if an A2 expectation moves" is insufficient here precisely because **nothing
moves** — the gap is silent.

### 3. IMPORTANT — `bulk` is the wrong lane, and the repo already says so in a comment

Plan Step 15 argues `bulk` because "routing is triggered by ingestion, is not a buyer-facing write".
`handler-registration.service.ts:190-196` pre-emptively rejects that exact reasoning for the sibling
job:

> *"`realtime`, by ADR-050's cost-of-starvation rule … It outranks the 'core-owned internal pass'
> instinct that would suggest `bulk`, **because that instinct is about who ENQUEUES the job, and the
> lane is about who is hurt when it is late.**"*

Both shipped fulfilment work job types are `realtime`:
`:200-204` `fulfillment.work.statusSync` → `'realtime'`; `:516-520` `fulfillment.work.dispatch` →
`'realtime'`, whose comment reads *"A dispatch is the outbound 'tell the holder to ship' for an order
that has just been routed: someone is waiting, and lateness costs a shipment."* A routing commit is
strictly upstream of that dispatch — a late route is a late shipment by construction. Recommend
`realtime`, or a written argument that survives the quoted comment.

Confirmed the boot gate works as the plan assumes: `sync-job-handler.registry.ts:108
assertFullLaneCoverage()`, invoked at `handler-registration.service.ts:525`, throws naming uncovered
types (`sync-job-handler.registry.spec.ts:203`). Edit points: add the literal to
`libs/core/src/sync/domain/types/sync-job.types.ts` (`fulfillment.work.dispatch` at `:184`), payload
type beside `libs/core/src/sync/domain/types/fulfillment-job-payloads.types.ts`, handler in
`apps/worker/src/sync/handlers/`, registration + DI in `handler-registration.service.ts` and
`sync-worker.module.ts:76`.

### 4. IMPORTANT — the abandon-reason spec asserts exact array contents and WILL fail

`libs/core/src/fulfillment/domain/types/routing-decision.types.spec.ts:34-38`:

```
expect([...RoutingDecisionAbandonReasonValues]).toEqual(['plan-pending','plan-not-conserving']);
```

Adding `router-timeout` / `router-failed` breaks this; it must be updated in the same commit (the
spec's own comment at `:41` anticipates *"#2395 widens this union with no migration"*, so this is an
expected edit, not a re-derive signal). Two things confirmed as the plan claims: the column is
`@Column({ type:'varchar', length: 64, nullable: true })`
(`routing-decision.orm-entity.ts:116`) so **no migration is needed**; and `:43`'s
`readRoutingDecisionAbandonReason('lock-lost')` sentinel does not collide with either new name.
No exhaustive `switch` over the union exists outside these coercion helpers.

### 5. SUGGESTION — `runInTransaction` on the port is safe

Only one implementer: `fulfillment-work.repository.ts:165
export class FulfillmentWorkRepository implements FulfillmentWorkRepositoryPort`. Every test double
is an object literal cast (`as unknown as jest.Mocked<FulfillmentWorkRepositoryPort>` —
`fulfillment-handshake.service.spec.ts:97`, `fulfillment-progress.service.spec.ts:30`,
`fulfillment-progress-ordering.spec.ts:57`), so a new member breaks nothing. No in-memory fake of
this port exists. `FulfillmentWorkTransaction` is already declared
(`fulfillment-work-repository.port.ts:69`) and already accepted by `terminalise` (`:184`). Note the
name `runInTransaction` is used elsewhere only as a *callback parameter name* in TypeORM mocks
(`sync-job.repository.spec.ts:68`, `webhook-ingestion.int-spec.ts:234`) — no collision.

### 6. IMPORTANT — `order_records.shippingAddressHash` and the `toOrm` omission doctrine

Confirmed the hash **can** be computed before redaction: `redactAddress` is applied inside
`OrderRecordService.persistOrder` (`order-record.service.ts:135,138`), *after*
`OrderIngestionService.buildUnifiedOrder` passes `shippingAddress: incoming.shippingAddress`
un-redacted (`order-ingestion.service.ts:1171`) into the `persistOrder` call at `:458`. The existing
helper is importable from where ingestion runs: `hashAddress` / `normalizeAddress` from
`@openlinker/shared/config` (used at
`customers/application/services/order-customer-projection-updater.service.ts:19,140,168`) — `orders`
already depends on `@openlinker/shared`.

The `toOrm` omission pattern is real and documented at
`order-record.repository.ts:2278-2320`: `syncStatus`, `syncAttempts`, `fulfillmentState`,
`cancelledAt`, the three `salesDocument*` columns and `omsAttention` are all left unset because each
is *OL-owned state no source payload carries, with a dedicated narrow UPDATE as sole writer*, and
`upsert()` races the reconciliation poll with no per-order lock.

**`shippingAddressHash` does NOT belong in that set** — it is derived from the ingested payload,
recomputed identically on every ingestion of the same order, so round-tripping it is idempotent and
race-free. It should be in the normal `toOrm` write set. But note the raw-SQL upsert path
(`:1846-1865`) restates the parameter tuple positionally against `toOrm`'s write set — **both must
be updated together**, and the file says so at `:1846` (*"The write set is defined once, by `toOrm` —
the parameter tuple below is …"*).

**Constructor arity is a real hazard, already flagged in-tree** (`order-record.entity.ts:246`):
*"this is a positional constructor, and inserting mid-list would silently shift every argument after
it at each of its call sites."* Append the new field **last**, after `buyerTaxId` (the current tail —
`order-record.repository.ts:2273`), with a default so existing call sites compile unchanged.

### 7. SUGGESTION — migration slot and parity spec

`1868000000000-…` is free: the tail is `1867000000000-add-fulfillment-handshake.ts` (`1866` is
`create-routing-decisions`). The plan's re-verify-at-push-time caveat stands — #2401/#2402 are live
on the wave branch. The parity spec's `TABLES` is at
`apps/api/test/integration/fulfillment-work-migration-parity.int-spec.ts:57`, and `:174-179` derives
its table-name assertion **from** `TABLES` rather than restating literals, so adding
`'order_records'` is a one-line edit — but the plan's Phase-B step-7 fallback is correctly reserved
for pre-existing drift.

### 8. SUGGESTION — nothing in the plan is already done or duplicates a merged parent

Verified absent from the tree: `selectPrimaryFulfillmentRouter`, `fulfillment.work.route`,
`shippingAddressHash`, `fulfillment-route-lock` / `FULFILLMENT_ROUTE_LOCK_TTL_MS` /
`FULFILLMENT_ROUTE_TIMEOUT_MS`, and any `runInTransaction` member on
`FulfillmentWorkRepositoryPort`. §2.1's claim that no `FulfillmentRouter` adapter can be dispatched
also holds. The plan's scope is genuinely unbuilt.

---

## Gate summary

| # | Rating | Finding |
|---|---|---|
| 1 | BLOCKING | `IFulfillmentRoutingService`/`FulfillmentRoutingService` name collision with `mappings` |
| 2 | BLOCKING | A2 global-only selection contradicts `resolveOneAuthority`'s documented invariant; regression D10 silently reopens for A2 |
| 3 | IMPORTANT | `bulk` lane contradicts the shipped sibling-job comment; use `realtime` or argue past it |
| 4 | IMPORTANT | `routing-decision.types.spec.ts:34` asserts exact abandon-reason array — must be updated |
| 5 | SUGGESTION | `runInTransaction` port widening is safe (one implementer, cast-literal doubles) |
| 6 | IMPORTANT | Hash is computable pre-redaction; keep it IN `toOrm`, update the raw-SQL tuple too, append constructor arg LAST |
| 7 | SUGGESTION | Migration slot 1868 free; parity spec derives from `TABLES` |
| 8 | SUGGESTION | No duplication with merged parents |
