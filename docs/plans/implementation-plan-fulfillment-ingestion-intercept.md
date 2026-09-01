# Implementation Plan: Fulfillment ingestion intercept (#2396, `W3a-7`)

**Date**: 2026-08-31
**Status**: Ruled — §5.1 resolved as **option A** (narrowed persistence); implemented
**Estimated Effort**: 1–1.5 days (implementation + gates), assuming §5.1 is resolved before coding

---

## 1. Task Summary

**Objective**: Insert the fulfilment routing intercept into `OrderIngestionService.syncOrderFromSource`,
between `persistOrder` and `syncOrder`, with three arms — `none` / `ambiguous` / `selected` — such that a
**held order never reaches `syncOrder`** and therefore produces no destination mirror.

**Context**: DESIGN §5.5 and ADR-054. #2395 shipped `RoutingCommitService` (selection, the #2047 four-part
gate, the one-transaction commit) and the `fulfillment.work.route` worker handler, whose own header records
that **#2396 owns the producer** and that every non-routed outcome there is currently **log-only** — the
persistence half is this issue's. #2397 shipped the router-filtered fan-out
(`OrderSyncRequest.destinationConnectionIds?`) that consumes what this intercept decides.

**Classification**: CORE — Application layer, plus Infrastructure **iff** §5.1 resolves toward new columns
(migration-bearing).

---

## 2. Scope & Non-Goals

### In Scope
- The three-arm intercept in `order-ingestion.service.ts`, positioned between `persistOrder` and `syncOrder`.
- Disposition of every `RoutingCommitOutcome` status (held vs today's path) — §6.3.
- Persistence of the routing block reason (shape pending §5.1).
- A characterisation test proving a router-less install is byte-identical.

### Out of Scope
- Any router implementation. `'FulfillmentRouter'` is deliberately absent from `CoreCapabilityValues`
  (#2393/#2403, asserted by a live spec); `@openlinker/oms` ships `supportedCapabilities: []`. The first
  real router is #2408/#2409.
- Changing `#2397`'s filter semantics. This plan hands it a value; it degrades as already designed.
- Frontend surfacing of the routing block (owned by the Wave-2 attention surfaces / #2357).
- Widening `AuthorityAttentionReasonValues` — that union is spec-pinned at exactly eight
  (`authority-attention-reason.types.spec.ts:48`, `toHaveLength(8)`) and guarded by a **live**
  `scripts/check-attention-reason-mirror.mjs` already wired into `check:invariants`; see §5.1.

### Constraints
- **ADR-053 no-injection invariant**: `fulfillment` injects no `orders` service. `orders` performs the write.
  Enforced by `scripts/check-no-injection-contracts.mjs` + `barrel-purity.spec.ts` +
  `fulfillment-no-injection-boot.int-spec.ts` (#2390).
- `orders → fulfillment` and `orders → fulfillment-authority` edges are permitted and already exist
  (`IFulfillmentWorkQueryService`, #2402).
- Zero edits to existing spec cases (the #2397 standard: pure additions).

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/orders/application/services/`), + CORE Infrastructure if §5.1 → columns.

**Capabilities involved**:
- `FulfillmentRouterPort` (#2393) — **never resolvable today**; supplied as an argument, per ADR-053.
- `IRoutingCommitService` / `ROUTING_COMMIT_SERVICE_TOKEN` (#2395) — barrel-exported from
  `@openlinker/core/fulfillment`; an `I*Service` + a Symbol token, both **allowed cross-context shapes** under
  `scripts/check-cross-context-imports.mjs`. Verified: `RoutingDecisionRepositoryPort` stays off the barrel
  by deny pattern, and this plan does not touch it.

**Existing services reused**:
- `selectPrimaryFulfillmentRouter` + `isFulfillmentRouterUnroutable` (`@openlinker/core/fulfillment-authority`).
- `ConnectionPort.list()` for claimants — the exact `loadClaimants` shape from
  `apps/worker/src/sync/handlers/fulfillment-work-route.handler.ts` (`supportedCapabilities: []`, `isActive`
  reported not filtered).
- `IOrderRecordService` for the write.
- The already-in-hand `order` object at the call site (see §6.4 — no snapshot re-read needed).

**New components**: one private intercept method on `OrderIngestionService`, one outcome→reason mapper, one
router-resolution seam (§5.2), and the persistence seam chosen in §5.1.

**Core vs Integration justification**: entirely CORE. The intercept is order-lifecycle orchestration; no
adapter is constructed on this path at all (the router seam answers `null`).

---

## 4. Research Findings (what the codebase already decides for us)

1. **`OrderSyncRequest.destinationConnectionIds?`** (#2397) is live at
   `libs/core/src/orders/application/interfaces/order-sync.service.interface.ts:56`. Contract, verbatim:
   *absent* ⇒ unfiltered (today's behaviour); *present and empty* ⇒ a router positively selected nobody.
   **"Getting that backwards silently stops destination provisioning on every install that exists."**
2. **The intercept point** is `order-ingestion.service.ts:521` (`this.orderSyncService.syncOrder({...})`),
   after `persistOrder` (:458), `reserveOrderInventory` (:466) and the customer-projection step.
3. **The route handler already exists** and consumes `fulfillment.work.route`. Its `resolveRouter` is a
   documented stub returning `null`, replaced by #2408/#2409.
4. **`updateOmsAttention` already exists** on `OrderRecordRepositoryPort` (:379) and
   `OrderRecordRepository` (:1484), producer-keyed, with a unit-tested `'routing'` producer case
   (`order-record.repository.spec.ts:251`). It is **not** yet exposed on `IOrderRecordService`.
5. **`sourcing-ambiguous` is already a declared attention state** — `specRow: 'A2-A'`,
   *"two enabled routers on one source, so neither routes"*, `surfaces: ['order', 'connection']`,
   `origin: 'authority-resolution'`, `producer: null`, `counted: true`. It is **derived on every read** and
   **never persisted**. This is the §5.1 blocker.
6. **The migration-parity spec is at `apps/api/test/integration/fulfillment-work-migration-parity.int-spec.ts`**
   (not `apps/worker` as briefed), and its `TABLES` list holds **only fulfillment tables** — `order_records`
   is absent. See §5.3.

---

## 5. Questions, Assumptions & BLOCKING findings

### 5.1 ✅ RESOLVED (orchestrator ruling: **option A**) — persistence narrowed against merged #2352

The issue body prescribes two new nullable `order_records` columns, `fulfillmentBlockReason` /
`fulfillmentBlockDetail`, following the #2100 `salesDocumentBlockReason` shape verbatim, and reconciles this
against DESIGN §5.2 by arguing the routing block reason *"is a different fact at order grain"*.

**That reconciliation no longer holds, because #2352 landed after it was written.** Concretely:

- `AuthorityAttentionReasonValues` already contains **`sourcing-ambiguous`** (`A2-A`), described as
  *"two enabled routers on one source, so neither routes"* — which is exactly this issue's `ambiguous` arm.
- Its descriptor declares `surfaces: ['order', 'connection']` and `counted: true`. So it **already renders at
  order grain** and is **already counted** in `Needs attention (N)`.
- Its `origin` is `'authority-resolution'` with `producer: null` — it is recomputed by `resolveAuthorities`
  on every read and is **never persisted by design**. `authority-attention-reason.types.ts` states the reason
  in terms: a stored copy *"would be a second answer to a question a pure function already answers, with a
  staleness window and no natural write trigger."*
- `order-record.orm-entity.ts:417` argues directly against the scalar shape for this column family:
  *"#2100's single `salesDocumentBlockReason` is safe because ONE authority re-decides the whole question…
  Here the writers are three unrelated subsystems (the reservation ledger, **routing**, the execution
  handshake)… A level-triggered scalar would make each producer's 'nothing is wrong' honest about its own
  question and a lie about the others'."*

So implementing the issue as literally written would (a) persist, at order grain, a state that is already
derived at order grain — double-reporting the same situation with a staleness window, and inflating the
`Needs attention (N)` count; and (b) re-introduce the level-triggered scalar that the sibling explicitly
rejected for this exact column family, alongside the producer-keyed array built to replace it.

**The three candidate resolutions:**

| | Shape | Cost |
|---|---|---|
| **B1** | Ship the two columns as the issue says | Double-reports `sourcing-ambiguous` at order grain; contradicts #2352's stated design; adds a migration; a second vocabulary for one situation |
| **B2** | Write through `updateOmsAttention(orderId, 'routing', outcome)` | No migration, no new vocabulary, correct level-trigger key. **But** `AUTHORITY_ATTENTION_PRODUCER_REASONS.routing` is 1:1 to `line-unfulfillable` ("a line cannot be shipped from anywhere"), which does **not** describe `in-doubt` / `contended` / `already-routed` / `router-not-wired`. Using it for those would be the precise anti-pattern the file names ("a producer could persist a state the table assigns to a different subsystem"). Widening the union means editing a spec-pinned eight-value list plus the live `check-attention-reason-mirror.mjs` (and its frontend counterpart) — **cross-issue vocabulary surgery** |
| **B3** | Persist **nothing** in this slice | The `ambiguous` arm is already derived and surfaced, so nothing is lost there. The held-but-not-routed arms (`in-doubt`, `contended`) stay log-only — the very gap #2395's header flagged as this issue's to close |

**RULING (orchestrator, recorded here rather than left in the thread): option A — the narrowing.**

Ship the two columns and the migration, but write them **only for a HELD-and-not-routed order**:
`in-doubt`, `contended`, `already-routed` / `already-live-elsewhere`. Specifically:

| Arm | Held? | Persists |
|---|---|---|
| `none` (`no-claimant`) | no | `null` (level-triggered clear) |
| `ambiguous` (`isFulfillmentRouterUnroutable`) | no | **nothing** — `null` only |
| `selected`, no router wired | no | `null` |
| `routed` | **yes** | **nothing** — the work object is the explanation (#2402) |
| `in-doubt` | **yes** | `routing-in-doubt` |
| `contended` | **yes** | `routing-contended` |
| `skipped: already-routed` / `already-live-elsewhere` | **yes** | `routing-already-live-elsewhere` |
| `refused` | no | `null` — the refusal is durable on the decision row |
| `skipped: order-cancelled` | no | `null` |

**Why the `ambiguous` arm persists nothing.** `'sourcing-ambiguous'` is spec row A2-A, already order-grain,
already `counted: true`, and typed `producer: null` — a spec pins that it has no producer with a
`@ts-expect-error`. Persisting it here would double-report into `Needs attention (N)`, the one number an
operator acts on, and a double-counted attention badge is worse than a missing one: it teaches the operator
the count is noise.

**Why not B2/option C.** `AUTHORITY_ATTENTION_PRODUCER_REASONS.routing` is 1:1 to `'line-unfulfillable'`
("a line cannot be shipped from anywhere" — a refund/return decision), which describes none of the three
transient states above. Widening a spec-pinned eight-value list plus its live
`check-attention-reason-mirror.mjs` is another issue's vocabulary and is explicitly **not** to be edited here.

**Why not B1 as literally written.** Accepting a known double-report as a "recorded gap" trades a correct
number for a comment.

**Consequence for the issue text.** This narrowing **departs from #2396's written body**, which predates
#2352. The departure, its citation (`authority-attention-reason.types.ts` — the `'sourcing-ambiguous'`
descriptor) and this table are recorded in the PR body, the migration header, the ORM column docblock and
`fulfillment-block-reason.types.ts`, so the next reader finds the reason at the code rather than only here.

---

*Superseded analysis retained below for provenance.*

**Original recommendation was B2, scoped — overridden by the ruling above.**

### 5.2 Design decision — router resolution, and the drift risk

`FulfillmentWorkRouteHandler.resolveRouter` is a private stub returning `null`, documented as replaced by
#2408/#2409. The intercept needs the same answer. Three options:

- **Duplicate the stub** in `OrderIngestionService`. Two places return `null` for one reason; when #2408 wires
  a real router, whoever edits one may not know the other exists — and the *silent* failure mode is the bad
  one: the handler routes while the intercept still passes through, so orders mirror to destinations **and**
  get routed. That is a double-shipment shape.
- **Extract a shared resolver.** It needs `IIntegrationsService`, so it cannot live in the `fulfillment` leaf
  (ADR-053 forbids the injection) and cannot live in the worker (core cannot import `apps/`). The natural home
  is `libs/core/src/orders/application/services/fulfillment-router-resolution.ts`, imported by both — the
  handler already imports `@openlinker/core/orders`.
- **Inject a seam** — a `FulfillmentRouterResolverPort` bound once in the host.

**Recommendation: extract one shared resolver** (option 2) and delete the handler's private stub in the same
commit. It is the smallest change that makes "one place returns null today, one place is edited by #2408"
structurally true, and it does not add a port with a single null implementation. The extraction is a pure move:
the function body stays `return null`, so no behaviour changes and no existing spec case moves.

### 5.3 Migration-parity spec — scope correction

The parity spec is `apps/api/test/integration/fulfillment-work-migration-parity.int-spec.ts` and its `TABLES`
list is fulfillment-only (`fulfillment_works`, `fulfillment_work_lines`, `fulfillment_holds`,
`fulfillment_work_rejections`, `fulfillment_progress_claims`, `routing_decisions`). `order_records` is not in
it. Under **B1**, adding `order_records` to that list would pull a large, long-standing table into a
column-by-column migration/entity comparison — likely surfacing pre-existing drift unrelated to this issue.
**Recommendation under B1**: extend the spec only if `order_records` comparison comes back clean on a trial
run; otherwise assert the two new columns directly and record why. Under **B2/B3** the spec is untouched.

### 5.4 Assumptions
- The `selected`-and-wired arm is **unreachable on every install today** (router seam returns `null`), which is
  what makes the byte-identical property hold and is exactly ADR-054's *"with no router configured the layer is
  a degenerate pass-through."*
- `undefined` (not `[]`) is the correct hand-off for every arm that reaches the fan-out. `[]` has no producer in
  this slice — held arms do not call `syncOrder` at all.
- A held order still gets `persistOrder`, `reserveOrderInventory` and the customer-projection update. Only the
  destination mirror is withheld; the order record itself must exist or the hold is invisible.

---

## 6. Proposed Implementation Plan

### Phase 0 — Characterisation first (must pass BEFORE any production edit)

1. **Add the byte-identical characterisation test**
   - **File**: `libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts` (additions only)
   - **Action**: On a no-claimant install (every connection's `config` declaring no `sourcing` authority),
     assert `syncOrder` is called with an argument object **exactly** equal to today's
     `{ order, sourceConnectionId, sourceEventId }` — a deep-equality assertion on the captured argument, not a
     property spot-check, so an added `destinationConnectionIds: undefined` key is caught. Use fake timers if any
     instant enters the payload.
   - **Acceptance**: **passes on unmodified `HEAD`**, and the run output is recorded. A test that only passes
     after the change proves nothing about byte-identity.
   - **Red-first counterpart**: a second case asserting the routing block writer is never invoked with a
     non-null reason on a no-claimant install. This one must be written so it *can* fail — verify by
     temporarily forcing a write.

### Phase 1 — The resolver seam (§5.2)

2. **Extract `resolveFulfillmentRouter`**
   - **File (new)**: `libs/core/src/orders/application/services/fulfillment-router-resolution.ts`
   - **Action**: `export async function resolveFulfillmentRouter(connectionId: string): Promise<FulfillmentRouterPort | null>`
     — body `return null`, carrying the handler's existing explanatory header verbatim (why it is **not**
     `getCapabilityAdapter(…, 'FulfillmentRouter')`: absent from `CoreCapabilityValues`, and adding the name
     would reopen the #2085 `enabledCapabilities` trap).
   - **Action**: delete the private stub from `fulfillment-work-route.handler.ts`; import the shared one.
   - **Acceptance**: handler specs unchanged and green; no existing spec case edited.

### Phase 2 — The intercept

3. **Add the three-arm intercept**
   - **File**: `libs/core/src/orders/application/services/order-ingestion.service.ts`
   - **Action**: a private `private async interceptFulfillmentRouting(order, connectionId): Promise<FulfillmentInterceptDecision>`
     called immediately before line 521. It:
     1. builds claimants from `ConnectionPort.list()` (the `loadClaimants` shape);
     2. calls `selectPrimaryFulfillmentRouter`;
     3. `holder === null && reason === 'no-claimant'` → **`none`**;
     4. `holder === null && isFulfillmentRouterUnroutable(reason)` → **`ambiguous`**;
     5. `holder !== null` → resolve the router; `null` → **`router-not-wired`**; otherwise call
        `IRoutingCommitService.route(...)` and map the outcome per §6.3.
   - **Action**: the call site becomes a branch — held decisions skip `syncOrder` and its `Promise.allSettled`
     settlement loop entirely and return `[]`; every other decision calls `syncOrder` with the argument object
     **unchanged** (no `destinationConnectionIds` key added).
   - **Acceptance**: Phase 0's deep-equality test still passes.

4. **Wrap the whole intercept in a catch**
   - **Action**: an unexpected throw from selection or the commit must **not** fail order ingestion. Log a
     PII-safe envelope (`error.name` + `connectionId` + `order.id`) and fall through to **today's path** —
     matching the `persistSalesDocumentOutcome` / auto-issue precedent at :650–690. Failing open to the mirror is
     the right direction here **only because** the router is unreachable this slice; note it explicitly in the
     code comment so #2408 revisits it.

### 6.3 Outcome disposition (the table the mapper must implement)

| Arm / outcome | Reaches `syncOrder`? | Hand-off | Why |
|---|---|---|---|
| `none` (no claimant) | **Yes** | `undefined` | ADR-054's degenerate pass-through. The only live path today. |
| `ambiguous` (any unroutable reason) | **Yes** | `undefined` | Issue body: *"`ambiguous` → persist reason, today's path"*. Two routers means neither routes; the order must still mirror or it silently stops shipping. |
| `router-not-wired` | **Yes** | `undefined` | The handler's own words: *"follows today's path unchanged"*. Withholding here would strand every order on an install that config-declares A2 before #2408 ships. |
| `routed` | **No — HELD** | — | Work objects exist; a hold that still mirrors is not a hold. |
| `in-doubt` | **No — HELD** | — | The router may have committed. Mirroring risks a double shipment. Decision stays `live` for resumption under the identical key (#2395). |
| `skipped: already-routed` | **No — HELD** | — | Work already exists from a prior pass. |
| `skipped: already-live-elsewhere` | **No — HELD** | — | Another decision holds the order. |
| `contended` | **No — HELD** | — | A peer may be mid-commit; the router was not called. Re-decided on the next transition. |
| `skipped: order-cancelled` | **Yes** | `undefined` | Nothing to route; today's path handles a cancelled order. |
| `refused` | **Yes** | `undefined` | Decision is terminal and durable; no work exists, so the order is not held. Reason persisted. |

**Rule**: every HELD arm that is not `routed` must persist a reason (subject to §5.1), or the order stops
silently — the exact failure #2395's header flagged.

5. **The outcome→reason mapper**
   - **File**: `libs/core/src/orders/application/services/fulfillment-block-reason.ts` (or the `*.types.ts`
     pure-rule exception if it sits with the union it maps onto — engineering-standards.md §"pure-rule exception").
   - **Action**: a `switch` over `RoutingCommitOutcome['status']` **and** over
     `FulfillmentRouterSelectionReason`, each with a `const _exhaustive: never = x` arm, so a new commit-outcome
     status or a new selection reason is a **compile error**, never a silent fall-through.
   - **Acceptance**: a spec deletes an arm and type-check fails.

### Phase 3 — Persistence (shape per §5.1)

6a. **(B2 — recommended)** Expose `markOmsAttention` on `IOrderRecordService` delegating to the existing
   `repository.updateOmsAttention`, and call it with producer `'routing'`. `{ kind: 'none' }` clears (the
   level-trigger), `{ kind: 'indeterminate' }` leaves the stored entry alone. **No migration.**
   Requires the §5.1 ruling on widening `AUTHORITY_ATTENTION_PRODUCER_REASONS.routing`.

6b. **(B1 — if ruled)** Add `fulfillmentBlockReason` / `fulfillmentBlockDetail` to
   `order-record.orm-entity.ts` (`varchar`, nullable, mirroring `salesDocumentBlockReason`'s shape and its
   "union enforced in TypeScript, no check constraint" note); add `markFulfillmentBlock` to
   `IOrderRecordService` + `OrderRecordRepositoryPort` + `OrderRecordRepository` as a conditional `UPDATE`
   modelled on `updateSalesDocumentBlock` (`IS DISTINCT FROM` guard so `null → null` costs no `UPDATE` and no
   `@UpdateDateColumn` bump); **omit both from `toOrm`, from `upsert`'s column tuple and from
   `persistIncomingSnapshot`**, with the `cancelledAt` / `salesDocument*` single-writer comment; migration
   `apps/api/src/migrations/1870000000000-add-order-fulfillment-block.ts` (tail is `1869000000000`).

7. **Level-triggered clear test** — a misconfigured install writes a reason; the misconfiguration is fixed;
   the next transition writes the clear. Required by the AC under either shape.

---

## 7. Alternatives Considered

- **Enqueue `fulfillment.work.route` instead of calling `route()` inline.** Rejected: the hold decision must
  precede the mirror, and an enqueue resolves after `syncOrder` has already run. It would also mean holding an
  order on the *expectation* of a routing decision that may never come. (The handler retains its value as the
  resumption path for `in-doubt`; nothing in this plan removes it.)
- **Pass `[]` to `syncOrder` for held arms** rather than skipping the call. Rejected: the issue and DESIGN §5.5
  both say *"a held order does not reach `syncOrder`"*, and #2397's `[]` arm is a *non-event* warn path designed
  for a router that selected nobody — a different fact from "this order is held".
- **A `FulfillmentRouterResolverPort`** with one null implementation. Rejected as a port with no second
  implementer; the shared function is the smaller change (§5.2).

---

## 8. Validation & Risks

- ✅ Hexagonal layering: intercept is application-layer; no adapter constructed; no domain framework import.
- ✅ ADR-053: `orders` writes; `fulfillment` injects nothing. #2390's boot int-test stays green.
- ✅ Cross-context shapes: `IRoutingCommitService` (an `I*Service`) + `ROUTING_COMMIT_SERVICE_TOKEN` (a Symbol)
  are both allow-listed shapes; no `*RepositoryPort` crosses.
- 🔴 **Risk — `undefined` vs `[]` inversion.** Handing `[]` on a pass-through arm silently stops destination
  provisioning on every existing install. Mitigated by the Phase-0 deep-equality assertion on the `syncOrder`
  argument, which fails if the key is present at all.
- 🟡 **Risk — double-reporting the ambiguity** (§5.1). Mitigated by the ruling; under B1 it must be recorded as
  a known gap.
- 🟡 **Risk — resolver drift** (§5.2). Mitigated by extraction + deleting the handler stub in the same commit.
- 🟡 **Risk — migration timestamp collision** (B1 only). `check-migration-timestamps` compares against
  `origin/main` only and **cannot see a sibling in flight**; three branches collided during this wave.
  **Re-verify the tail immediately before pushing.**

---

## 9. Testing Strategy & Acceptance Criteria

**Unit** (`order-ingestion.service.spec.ts`, additions only):
- Byte-identical characterisation on a no-claimant install (passes pre-change).
- One case per §6.3 row: held arms assert `syncOrder` **not called**; pass-through arms assert it is called
  with the unchanged argument object.
- Exhaustiveness: removing a mapper arm fails `type-check`.
- Level-triggered clear.
- Intercept throw ⇒ today's path, order ingestion unaffected.

**Integration**: #2390's `fulfillment-no-injection-boot.int-spec.ts` stays green. Under B1 only, the
migration-parity spec per §5.3.

**Acceptance criteria** (from the issue, annotated):
- [ ] Columns added nullable + `migration:show` clean — *B1 only; N/A under B2/B3*
- [ ] `OrderIngestionService` is the only writer; both absent from `toOrm`, asserted by a re-persist test
- [ ] `fulfillment` injects no `orders` service; `orders` performs the write (#2390 green)
- [ ] A held order produces no destination mirror
- [ ] The reason clears once the misconfiguration is fixed
- [ ] Tests added for non-trivial logic; no CORE ↔ Integration boundary violation

**Gates**: `pnpm lint` (0 errors), `pnpm type-check`, `pnpm test`, **full** `pnpm test:integration` (this edits
the order path), `pnpm check:invariants` (count derived at run time, never quoted).
Known pre-existing and never chased: **#2638** `earliest-order-date` (passes under `TZ=UTC`), **#2639**,
PrestaShop container-boot `Port 80 not bound` (Docker contention).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions)
- [x] Idempotency considered (level-triggered write; commit gate owned by #2395)
- [x] Event-driven patterns respected (handler retained as the `in-doubt` resumption path)
- [x] Error handling comprehensive (intercept fails open to today's path, PII-safe log)
- [x] Testing strategy complete (characterisation-first, red-first per guard)
- [x] Naming conventions followed
- [x] Plan is execution-ready **once §5.1 is ruled on**

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — § Fulfillment Authority, § Orders, § Data Flow §1
- ADR-050 / 052 / 053 / 054 / 055 / 062
- `docs/plans/analysis/DESIGN-oms-authority-model.md` §5.1–5.5
