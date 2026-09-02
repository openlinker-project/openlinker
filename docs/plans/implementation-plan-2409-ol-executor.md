# Implementation Plan: OL executor — auto-accept + work state from OL tables (#2409, `W3a-18`)

**Date**: 2026-08-31
**Status**: Ready for Review
**Estimated Effort**: ~1 day
**Branch**: `2409-ol-executor` (base `origin/oms-programme-wave-3a`)

---

## 1. Task Summary

**Objective**: ship the first real `FulfillmentExecutorPort` implementation — the OL-OMS executor in
`libs/oms/src/execution/` — which **auto-accepts** work offered to it and answers from OpenLinker's own
tables rather than a vendor API, and advertise `FulfillmentExecutor` on the `openlinker.oms.v1` manifest so
the capability becomes assignable.

**Context**: DESIGN §9 — *the plugin descriptor **is** the OMS's adapter to OpenLinker; the only asymmetry
is below the port line, where the OL-OMS answers from OL's own tables instead of a vendor API.* #2405 shipped
the descriptor with an empty `supportedCapabilities` and an empty dispatch table, explicitly deferring
`FulfillmentExecutor` to this issue.

**Classification**: Integration (a plugin package implementing a CORE port). No CORE behaviour changes.

---

## 2. Scope & Non-Goals

### In Scope
- `OlFulfillmentExecutorAdapter implements FulfillmentExecutorPort` under `libs/oms/src/execution/`.
- Advertising `FulfillmentExecutor` on `omsAdapterManifest.supportedCapabilities` and wiring it into
  `createOmsPlugin`'s `dispatchCapability` table.
- Running #2404's `runFulfillmentExecutorContract` against it (the kit's first real subject).
- Correcting every live claim in the tree that says *"no shipped adapter manifest advertises
  `FulfillmentExecutor`"* — that sentence becomes false the moment this lands.

### Out of Scope (with owners)
- **Progress reporting.** The OL-OMS reports progress through the operator pick-list surface (#2406/#2410),
  not through this port. This change does **not** become `IFulfillmentProgressService.record()`'s first
  production caller — see D2.
- **`FulfillmentStatusSource`.** Deliberately not implemented — see D2.
- **Plugin-owned `oms_*` working state** (pick-list rows, wave state). Nothing in the executor needs it —
  see D1. It arrives with the first surface that has state of its own (#2406/#2410).
- **The OL router** (`FulfillmentRouterPort`) — #2408, the sibling half, also in `libs/oms`.
- **The timeout-as-rejection sweep** — #2712. This change changes the *shape* of that problem; see §8.

### Constraints
- `libs/oms` must remain HTTP-free (`scripts/check-outbound-http.mjs` `SCAN_ROOTS`, bare-`fetch` ESLint ban)
  and credential-less (ADR-055).
- `HostServices` must not be widened (ADR-062 decision 4, pinned by `host-services-not-widened.spec.ts`).
- `libs/oms` may not import a `*RepositoryPort` from a core context
  (`scripts/check-cross-context-imports.mjs` deny pattern).

---

## 3. Architecture Mapping

**Target Layer**: Integration — `libs/oms/src/execution/`.

**Ports involved**: `FulfillmentExecutorPort` (implemented); `FulfillmentStatusSource` (deliberately not).

**Existing components reused**: `dispatchCapability` (`@openlinker/plugin-sdk`), `omsAdapterManifest`,
`createNestAdapterModule`, `runFulfillmentExecutorContract` (`@openlinker/core/fulfillment/testing`).

**New components**: one class, one spec, one barrel line.

**Core vs Integration justification**: CORE already owns everything that changes state — the handshake claim,
the counters, the two status axes, the work row. The executor is the *holder's answer*, which is by
definition adapter-side. Nothing in `libs/core` is edited except docblock sentences this change falsifies.

---

## 4. Design decisions

### D1 — The executor is STATELESS, and that is what makes its contract guarantee true

`FulfillmentRequest.idempotencyKey` carries a stated guarantee: *"a repeat under the same key must return the
ORIGINAL outcome and must never create a second assignment."*

A vendor adapter honours the second half by remembering keys. The OL-OMS honours it **vacuously and more
strongly**: it *creates no assignment at all*. The assignment is the work row's holder assignment, which CORE
owns (`assignHolder` / `claimDispatchAttempt` / `recordAcceptance`). There is no vendor-side order to
duplicate, so there is nothing a second call could create.

The first half — replay the original outcome — is then satisfied **by construction** rather than by memory:
the answer is a pure function of the request. That is a stronger property than a store gives, because a store
can be lost and a pure function cannot.

**Naming.** It is an ADAPTER under `engineering-standards.md § Naming Conventions` — `*.adapter.ts`,
class `{System}{Capability}Adapter` — exactly like `ErliOfferManagerAdapter` and its two siblings.
Adapting OL's own tables rather than a vendor API changes what sits below the port line, not what the
file is; and being the FIRST executor is the reason to match the convention rather than a licence to
start a second one, since #2408 and every third-party executor copy whatever lands here. (A
`*.executor.ts` suffix was drafted and rejected: `find libs apps -name "*.executor.ts"` returns nothing.)

Consequence: **no `oms_*` table, no TypeORM dependency in `libs/oms`, no migration.** This matters
concretely — three sibling migrations collided on the tail today, and adding a fourth for state nothing reads
would be cost with no benefit.

### D2 — `FulfillmentStatusSource` is deliberately NOT implemented

`FulfillmentStatusSource` is the pull-shaped read **that serves a polling holder** — a vendor offering no
webhook. The OL-OMS is in-process and has no wire.

Implementing it would be actively wrong, not merely redundant. `getWorkFulfillmentStatus` would have to read
`fulfillment_works`' own counters and report them as *observed progress*; `IFulfillmentProgressService.record()`
writes those same counters. That is a closed loop — OL reporting OL's rows back to OL — and it is exactly the
**"second source of truth"** failure this issue's framing warns against. Every poll would be either a no-op or
a burnt duplicate claim, and the first time a counter disagreed there would be two answers to one question.

This is asserted, not merely intended: the contract kit's applicability is **structural**, so the four
`status/` cases are *absent from the report* rather than present-and-passing, and
`expectedFulfillmentExecutorContractCaseIds` is the single function deciding — so a spec can assert the
absence positively.

**Therefore this change does not become `record()`'s first production caller.** #2400's handoff named #2398's
status source as that caller; the OL executor declines the sub-capability, so the handoff passes through
untouched to whichever holder polls first. Progress for OL-executed work arrives from the operator's pick-list
action (#2406/#2410).

### D3 — `acceptedAt: null`, and the claim-guard consequence (report this)

The contract suite calls `requestFulfillment` twice with one key and requires a byte-identical outcome
(`JSON.stringify` comparison). A `new Date()` per call therefore **fails the contract**.

That is not an accident of the suite — it is the contract discovering a real property: **the only
replay-stable acceptance instant an executor without its own store can offer is `null`.** And `null` is a
first-class documented outcome: *"accepted by a holder that reported no instant of its own"*, distinguished
from "never accepted" by `requestStatus`.

**The consequence must be reported rather than buried.** `recordAcceptance` is guarded on
`"requestStatus" = 'submitted' AND "acceptedAt" IS NULL`, and its docblock says the second conjunct *"is the
guard that still holds if a future writer moves `requestStatus` without coming through here."* An
auto-accepting executor writes `acceptedAt = null`, so for OL-executed work — the common case this wave
creates — **that second conjunct no longer narrows anything**, and at-most-once acceptance rests on the
`requestStatus` conjunct alone. Nothing today moves `requestStatus` outside the handshake, so this is not a
live defect; it is a defence-in-depth layer silently thinned, and it belongs in the PR body and in a
follow-up rather than in a comment nobody reads.

### D4 — `externalWorkId: null`

The holder assigns no reference of its own: the work row **is** the record. `null` is the documented value for
exactly that ("`null` when it assigns none"). Echoing `workId` back would put a copy of core's own primary key
in a column meaning "the holder's foreign reference", and #2400 correlates inbound progress on it.

### D5 — Cancellation is accepted, and the executor may honestly say so

`requestCancellation` answers `accepted`. The port warns that a `void` cancellation *"would assert a
compliance the contract cannot obtain"* — that is a statement about the general case, where a third party is
physically committed. Here the physical work is OpenLinker's own and no third party is committed, so the
compliance genuinely **can** be obtained. This is precisely ADR-055's "the only asymmetry is below the port
line".

Rejecting instead would be worse: it would invent a refusal from a holder that has no independent will, and
`blocking: true` would then exclude the OL-OMS from re-sourcing its own work.

**A gap this change makes REACHABLE — not a pre-existing one.** Neither this executor nor core's
handshake checks the EXECUTION axis before cancelling: `requestCancellation` is guarded only on
`requestStatus === 'accepted'`, and for OL-executed work `requestStatus` **stays** `accepted` for the life
of the work (completion moves the execution axis, not the negotiation axis). So a cancellation against work
an operator has already picked, packed and shipped answers `accepted`, and core persists
`cancellation_accepted` — a record asserting the holder gave back a parcel that is in transit.

It is tempting to file that as core's and pre-existing. That would be wrong, and by this plan's own D6
reasoning: the path was **unreachable** until now, because no `FulfillmentExecutorPort` implementation
existed anywhere in the tree. #2409 is what makes it reachable, so #2409 is what must report it.

It is deliberately **not** fixed here by answering `rejected` — that is the "invent a refusal on the
operator's behalf" this decision exists to refuse, and it would additionally need a work-status read
through a seam that does not exist. **Owner**: the operator surface that can see a pick in flight
(#2406/#2410), or a core-side guard on `FulfillmentWorkStatus` in the handshake. Raised in the PR body.

### D6 — Advertising the capability: what becomes reachable

`FulfillmentExecutor` has been in `CoreCapabilityValues` since #2403 but no manifest advertised it. Adding it
to `omsAdapterManifest` makes four things go from **declared-only** to **reachable**:

1. **A3 (`fulfillment-execution`) becomes assignable through the UI** for an `openlinker` connection. Both
   capability-checkbox surfaces intersect the adapter's advertised list with the core set, so before this the
   value round-tripped only through a hand-rolled `PATCH /connections/:id`.
2. `getCapabilityAdapter(connectionId, 'FulfillmentExecutor')` resolves — so
   `apps/worker/src/sync/handlers/fulfillment-work-dispatch.handler.ts` can now actually dispatch work to an
   OL-OMS connection instead of raising its retryable "could not resolve" error.
3. `listCapabilityAdapters({ capability: 'FulfillmentExecutor' })` starts returning the OMS connection.
4. `InboundRoutingPolicyService`'s `'fulfillment'` arm can now resolve **gated** rather than `ungated` — it
   routes to `fulfillment.work.statusSync` when the capability is supported *and enabled*. It still requires
   an operator to enable it on the connection, so no existing deployment changes behaviour.

None of this activates on its own: an OL-OMS `Connection` row is only created when an operator enables the
OMS (ADR-055's zero-config non-negotiable, pinned by `oms-connection-never-seeded.int-spec.ts`), and the
capability must then be enabled on it.

### D7 — `OmsModule` stays on `createNestAdapterModule`

#2405 predicted that #2408/#2409 would force the Erli #1198 conversion to a hand-written `@Module` because
they would need injected core services. **For #2409 that turns out not to be true** — D1 leaves the executor
with no dependencies at all — so this change does not pay the ADR-051 cost #2405 described (dragging
`ShippingModule` / `MappingsModule` providers into the `events`, `scheduler` and `maintenance` roles). The
conversion, if it is needed, belongs to #2408, which is the half with real reads. `createOmsPlugin(deps?)`
keeps its optional-deps signature untouched.

---

## 5. Questions & Assumptions

- **Assumption (boundary with #2408)**: #2408 owns `FulfillmentRouter` and any `OmsPluginDeps` injection;
  #2409 owns `FulfillmentExecutor` and injects nothing. Both edit `oms.plugin.ts`
  (`supportedCapabilities` + the dispatch table) and `index.ts`, so a textual conflict is expected and must be
  resolved **by intent, not by textual merge** — a past merge here produced two `exports:` keys, valid
  TypeScript that silently drops the first.
- **Open**: whether the `acceptedAt` claim-guard thinning (D3) warrants a core-side follow-up making
  `recordAcceptance` guard on something that is non-null for every holder. Raised in the PR; not fixed here,
  because widening a core guard for the benefit of one adapter is the reviewer's call, not the adapter's.

---

## 6. Implementation Plan

### Phase 1 — the executor

1. **`libs/oms/src/execution/ol-fulfillment-executor.adapter.ts`** — `OlFulfillmentExecutorAdapter
   implements FulfillmentExecutorPort`. Two methods, both pure functions of their argument, both returning the
   `accepted` arm with `externalWorkId: null` and `acceptedAt: null`. File header states D1/D3/D4/D5 with
   their reasons.
   - *Acceptance*: no constructor dependencies; no import of anything but the port's types.
2. **`libs/oms/src/execution/index.ts`** (or direct barrel export) — export the class from
   `libs/oms/src/index.ts` so host int-specs can name it.

### Phase 2 — the manifest and dispatch

3. **`libs/oms/src/oms.plugin.ts`** — add `'FulfillmentExecutor'` to `supportedCapabilities`; add
   `{ FulfillmentExecutor: () => new OlFulfillmentExecutorAdapter() }` to the `dispatchCapability` table; rewrite the
   manifest docblock paragraph that explains why the array is empty.
4. **`libs/oms/src/__tests__/oms-plugin.spec.ts`** — the `toEqual([])` assertion at line 25 becomes
   `toEqual(['FulfillmentExecutor'])`; add a case asserting the factory returns an `OlFulfillmentExecutorAdapter` for
   that capability and still throws for an unknown one.

### Phase 3 — the contract kit (the evidence)

5. **`libs/oms/src/execution/__tests__/ol-fulfillment-executor.adapter.spec.ts`**
   - `runFulfillmentExecutorContract(() => new OlFulfillmentExecutorAdapter(), { subject: 'OlFulfillmentExecutorAdapter' })`.
   - A positive assertion that `isFulfillmentStatusSource(executor) === false` **and** that
     `expectedFulfillmentExecutorContractCaseIds(executor)` contains none of
     `FULFILLMENT_STATUS_SOURCE_CONTRACT_CASE_IDS` — D2 asserted rather than assumed.
   - An **overlapping** replay assertion, never sequential: call `requestFulfillment` with two *interleaved*
     distinct keys and assert each key's two answers match each other, so a shared-mutable-state
     implementation fails (#2399's `[1, 2]` precedent). **Its purpose must be stated in the test itself**:
     against a stateless executor it cannot fail today, so as evidence about THIS build it is vacuous —
     it is shipped to constrain a FUTURE implementation that adds state, and a comment saying so is what
     stops the next reader treating a tautology as proof.
   - **The red-first protocol that actually works here**: temporarily change `acceptedAt` from `null` to
     `new Date()`, confirm the contract kit's `request/replays-original-outcome` case goes red **and that
     the red names that case** (not a `TS6133` with `Tests: 0 total`), then revert. That is a real red for
     the right reason, and it is simultaneously the evidence for D3 — the decision that forces `null`.
   - Assertions that `acceptedAt` is `null` and `externalWorkId` is `null`, each citing why.

### Phase 4 — documentation truth

6. Correct the now-false *"no shipped adapter manifest advertises `FulfillmentExecutor`"* claim at every live
   site: `fulfillment-executor.port.ts`, `canonical-inbound-event.types.ts`, `adapter.types.ts`,
   `inbound-routing-policy.service.ts`, its spec (comment **and** the `TODAY'S REAL CASE` test name),
   `apps/api/test/integration/fulfillment-inbound-routing.int-spec.ts` (same), `docs/plugin-author-guide.md`,
   `libs/oms/README.md`, and `docs/architecture-overview.md` (§ executor port, § OL-OMS plugin).
   - **Care required, and the guard is NOT the obvious one.** `scripts/check-core-capability-mirror.mjs`
     explicitly disclaims the plugin guide (*"NOT checked here … already owned by
     `check-plugin-guide-quotes.mjs`. One fact, one guard."*). The real guard is
     **`scripts/check-plugin-guide-quotes.mjs`**, which quotes `adapter.types.ts` **lines 38–77 verbatim**
     into a fence in the guide AND asserts a link line containing the literal `adapter.types.ts:38-77`.
     The `FulfillmentExecutor` comment sits inside that range, so the edit must be **line-count-neutral**
     (rewrite lines in place). Adding or removing a line there turns this into a four-file lockstep:
     the source, the guide's fence, the guide's link line, and the script's own `guideLinkSubstring`.
   - **Verified clean, do not re-litigate**: `docs/capabilities.md` mentions `FulfillmentExecutor` at
     lines 73 and 265 but carries no "no manifest advertises" claim, so it needs no edit; and
     `@openlinker/oms` is already in both `plugins.ts` files and both `test/jest-integration.cjs` mapper
     blocks, so making the plugin dispatch something introduces no mapper gap.
   - Historical `docs/plans/**` records are **not** edited — they record what was true when written.

---

## 7. Alternatives Considered

**A1 — persist acceptances in an `oms_fulfillment_acceptances` table, replaying a stored `acceptedAt`.**
Rejected. It buys a real acceptance instant, but at the cost of a TypeORM dependency in a package that has
none, a fourth migration into a colliding tail, and a second store of a fact core already records
(`requestStatus` + the row's `updatedAt`). D1's argument is decisive: the guarantee the store would provide is
*already* satisfied more strongly by statelessness, because this holder creates no assignment to duplicate.

**A2 — implement `FulfillmentStatusSource`, reading the work row.** Rejected as the second-source-of-truth
trap; see D2. It would also require a cross-context read seam that does not exist (`IFulfillmentWorkQueryService`
is order-keyed and returns a link resolution), i.e. it would mean editing a sibling's interface that #2406
owns.

**A3 — reject cancellation when the work is past a point of no return.** Rejected for this slice: it needs a
work-status read (A2's seam problem) and it would have the adapter invent a refusal on the operator's behalf.
Recorded as the known gap in D5 instead.

**A4 — return `workId` as `externalWorkId`.** Rejected; see D4.

---

## 8. Validation & Risks

- **Risk — the capability becomes live.** Advertising it makes an OL-OMS connection a real dispatch target.
  Mitigated by ADR-055's never-seeded rule plus the per-connection capability enablement; asserted by running
  the full integration suite, since manifest-capability changes ripple into routing int-specs.
- **Risk — mirror scripts.** `check-core-capability-mirror.mjs` compares `adapter.types.ts` against the plugin
  guide textually. Both sides move in one commit and `check:invariants` is **derived, not quoted**.
- **Risk — `libs/oms` conflicts with #2408.** Expected; resolved by intent. If the executor/router boundary is
  ambiguous at merge time, escalate rather than guess.
- **#2712 (timeout-as-rejection sweep) — what this change does to it.** Auto-accept makes `submitted`
  effectively transient for OL-executed work: the answer arrives inside the same call, so the only way such a
  work sits in `submitted` is a process death between `claimDispatchAttempt` and `recordAcceptance`. So the
  sweep is still needed, but for **crash recovery rather than an unresponsive holder** — and for this holder a
  timeout must **not** be treated as a rejection: the retry will auto-accept, and a `blocking` rejection would
  exclude the OL-OMS from re-sourcing its own work. #2712 must therefore distinguish "holder never answered"
  from "we crashed mid-handshake", which it does not today.

---

## 9. Testing Strategy & Acceptance Criteria

- Unit: `libs/oms/src/execution/__tests__/ol-fulfillment-executor.adapter.spec.ts` (Phase 3).
- Unit: `libs/oms/src/__tests__/oms-plugin.spec.ts` (manifest + dispatch).
- Integration: no new int-spec. The full suite is run because manifest capabilities ripple.
- **Red-first discipline**: every claim is verified by making it fail first, and the red is checked to be *for
  the right reason* — a `TS6133` with `Tests: 0 total` is a false pass.

**Acceptance**
- [ ] Passes `describeFulfillmentExecutorContract` (i.e. `runFulfillmentExecutorContract`), all 7 base cases.
- [ ] Emits progress only through `IFulfillmentProgressService.record()` — **satisfied by absence**: it
      emits none (D2). Reported as vacuous rather than ticked, because the criterion was written assuming
      this executor would report progress; a reader must not infer a progress path exists.
- [ ] No HTTP client in the package dependency graph (`check-outbound-http.mjs` already scans `libs/oms`).
- [ ] `isFulfillmentStatusSource` is asserted `false`, positively.
- [ ] No architecture boundary violations; `check:invariants` derived and green.

---

## 9a. Findings during implementation (added after the plan was written)

**F1 — #2404's `request/replays-original-outcome` case cannot catch the violation it is about.**
Discovered while red-first-checking D3. With `acceptedAt: new Date()` — the single most likely real
violation of the port's replay rule, and precisely what D3 forbids — the contract case stays **GREEN**.
The case compares the two answers via `JSON.stringify`, which renders a `Date` as an ISO string, and
two in-process calls land inside the same millisecond, so the strings are identical. Forcing the two
instants a second apart makes the case fail, which is what proves the mechanism rather than assuming
it. The kit's own docblock anticipated a weaker version of this ("a replay differing only in a value
those two collapse is a replay this contract does not distinguish") but treats it as adequate; it is
not, because the collapse is not a rare tie — it is the *normal* outcome for the exact defect. The
adapter's own `acceptedAt: null` assertion is therefore the deterministic guard, recorded in the spec
so nobody deletes it as redundant with the suite. **Owner: #2404** (a monotonic-clock injection point,
or comparing structurally rather than by `JSON.stringify`).

**F2 — the `enabledCapabilities` retro-fill `libs/oms/README.md` assigned to this issue is deliberately
not built.** The README said #2409 "additionally owns retro-filling `enabledCapabilities` on OMS
connections created before it, since that column is stamped at create and never back-filled". The
concern is real in general (the #2085 shape), but no migration ships, on two grounds. The whole OMS
wave is unreleased, so a pre-#2409 OMS connection can exist only on a developer's own stack running
the wave branch — the migration would be dead code on every real install while spending a scarce
migration timestamp against a tail three siblings collided on today. And A3 is an **authority**:
silently granting `FulfillmentExecutor` would assign "who holds fulfilment work" on the operator's
behalf, which is the same class of upgrade-time surprise ADR-055's never-seeded rule exists to prevent.
An operator ticks the capability on the connection instead. The README now records that disposition
rather than the obligation.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — adapter implements a CORE port, CORE untouched behaviourally.
- [x] Respects CORE ↔ Integration boundaries — no `*RepositoryPort` import, no `HostServices` widening.
- [x] Uses existing patterns — Erli manifest-grows-with-its-adapter precedent (#980 → #984).
- [x] Idempotency considered — D1.
- [x] Error handling — the port declares no error contract (deferred to `W4-1`); the executor adds none.
- [x] Testing strategy complete.
- [x] Naming conventions followed.
- [x] Plan is execution-ready.
