# Implementation Plan: Capability registry 10 → 12 and the pinned mirrors (#2403 / `W3a-14`)

**Date**: 2026-08-30
**Status**: Ready for Review (revised after the readiness gate — see §5)
**Estimated Effort**: 3–4 hours
**Issue**: [#2403](https://github.com/openlinker-project/openlinker/issues/2403) — Wave 3a (epic #2412), stream S2
**Base branch**: `oms-programme-wave-3a` (NOT `main`)

---

## 1. Task Summary

**Objective**: add the two OMS dispatch capability names that the tree can actually dispatch — `AvailabilityAuthority` and `FulfillmentExecutor` — to `CoreCapabilityValues`, taking it from 10 members to **12**, and keep every hand-maintained mirror of that array in lock-step.

**The issue predicted 13.** The readiness gate read the tree and found the third name, `FulfillmentRouter`, fails the entry rule the array exists to carry. It is deferred, with the reason recorded in §5. The requester owns #2403's text and is amending its acceptance criterion to 10 → 12.

**Context**: design §9 (REVIEW G7) establishes the rule *a name enters `CoreCapabilityValues` iff a call site resolves it by connection id through `getCapabilityAdapter`*. ADR-052 assigns availability (A1) and fulfilment execution (A3) to holders discovered by narrowing a dispatched adapter, so both are resolved by connection id and both belong in the closed array. The array is copied by hand into four other places; two of those copies drifted silently before `scripts/check-core-capability-mirror.mjs` existed (#2351).

**Classification**: CORE (domain types) + Frontend (mirrored union + help copy) + Documentation + DX (invariant guards).

---

## 2. Scope & Non-Goals

### In scope
- `CoreCapabilityValues` 10 → 12: `AvailabilityAuthority`, `FulfillmentExecutor`.
- The exact-array spec in `libs/core/src/integrations/domain/types/__tests__/adapter.types.spec.ts`.
- Mirror 1 — `CORE_CAPABILITY_VALUES` (`apps/web/.../connections/api/connections.types.ts`).
- Mirror 2 — `CAPABILITY_HELP` (`apps/web/.../connections/lib/capability-metadata.ts`).
- Mirror 3 — the fenced table in `docs/capabilities.md`.
- **Mirror 4, which the issue does not name** — the verbatim quote of the array in `docs/plugin-author-guide.md` and its pinned line range in `scripts/check-plugin-guide-quotes.mjs`. See §5.
- **Mirror 5 (gate finding W1)** — a spec pinning every non-`'config-only'` `AUTHORITY_KIND_DESCRIPTORS[*].capability` to a member of `CoreCapabilityValues`.
- A spec asserting `MasterReservationWriter` appears in no manifest and in no capability list, pointing at #2315.
- Red-first evidence per mirror, per direction.

### Out of scope (and why)
- **`FulfillmentRouter`.** Deferred — see §5. Zero occurrences in the tree; A2 is `'config-only'`.
- **The ports.** `AvailabilityAuthorityPort` / `FulfillmentExecutorPort` live in `libs/core/src/fulfillment/**`, owned by the sibling agent working #2391. The capability *value* and the port *interface* are separable — `getCapabilityAdapter<T>` is generic over `T` and the registry keys on a string — so nothing here needs a port to exist. This plan touches no file under `libs/core/src/fulfillment/`.
- **Wiring dispatch.** No call site resolves either name in this slice. Nothing constructs an adapter.
- **The five advertised-without-dispatch names** (`AvailabilityHolder`, `AvailabilityStreamer`, `FulfillmentStatusSource`, `LifecycleAuthorityProvider`, `ReturnSourceReader`). The issue lists them to say what does NOT enter the registry. `ReturnSourceReader` already exists as a guard-only sub-capability (#2329); the other four are not created here.
- **`MasterReservationWriter`.** A named deferral (#2315, ADR-061). Asserted absent, never added.
- **`AuthorityKindValues` mirror script.** REVIEW H8a mandates it *with the enumeration*, i.e. #2311. W1 therefore ships as a **spec**, not as an edit to `scripts/check-authority-kind-mirror.mjs`.
- **Manifest changes.** No adapter advertises either name, so neither is assignable through the UI or the API today. Deliberate (§8).

### Constraints
- `apps/web` cannot import `@openlinker/core` (#591) — mirror 1 is a copy by construction.
- Ordering is part of the contract: all three `check-core-capability-mirror.mjs` checks compare order, not just membership.
- Base is `oms-programme-wave-3a`, which already carries `ReturnsAuthority` (#2351). Verified: the array has 10 members today.

---

## 3. Architecture Mapping

**Target layers**: CORE domain types (`libs/core/src/integrations/domain/types/`), Interface (frontend union + help copy), Documentation, DX specs.

**Capabilities involved**: `CoreCapability` — the closed well-known set. The open extension axis (`AdapterMetadata.supportedCapabilities: string[]`, #576) is untouched.

**Existing services reused**: none. This change adds no service, no port, no adapter, no module, no migration.

**Core vs Integration justification**: `CoreCapabilityValues` is the vocabulary CORE publishes for host-side discovery and DTO validation (`@IsIn` on both connection DTOs). It cannot live in an integration — an integration declares which names it *supports*, never which names exist.

---

## 4. External / Domain Research

None — no external system is involved.

**Internal precedent followed**: #2351 (`ReturnsAuthority`, 9 → 10) is the exact shape. It added one value, updated the same four places, and shipped `check-core-capability-mirror.mjs` because two of the three drifts it found were silent. This change is that change with two values instead of one, plus mirrors 4 and 5.

---

## 5. Questions & Assumptions — resolved by the readiness gate

### RESOLVED (Critical) — `FulfillmentRouter` is deferred; the count is 10 → 12

The gate found `FulfillmentRouter` has **zero occurrences anywhere in the repo**, and A2 (`sourcing`) is declared `capability: 'config-only'` at `libs/core/src/fulfillment-authority/domain/types/authority-kind.types.ts:106`, with its reason stated in place: *"per ADR-054/ADR-055 the router ships as a connection-backed plugin, so the candidate set is configuration rather than a narrowed capability."* `resolveAuthorities` consumes that literal at `authority-resolution.types.ts:303-304` and **skips the `supportedCapabilities` gate entirely** for A2. So no code path can pass `'FulfillmentRouter'` to `getCapabilityAdapter` — the exact condition the entry rule excludes.

**Decision: ship two. The rule wins over the number.**

The strongest argument is in-repo precedent, not principle. **#2220's `ModifiedProductLister` was deliberately kept OUT of `CoreCapabilityValues` and every manifest** — guard-only — for this same reason: `Connection.enabledCapabilities` is stamped at create and **never retro-filled**, so gating on a newly-added name drains nothing for every connection that already exists (the #2085 shape). The cost accepted there was operator-facing discoverability. The danger is not that an unused name is inert; it is that **an advertised name invites someone to gate on it**, and that gate then silently does nothing. Landing `FulfillmentRouter` now hands the next person exactly that invitation, and a comment saying "don't" is the stated-rule-with-no-mechanism shape this programme keeps finding.

**Rejected: flipping A2 to `capability: 'FulfillmentRouter'`.** It is a live regression — `resolveAuthorities` would start gating A2 on `supportedCapabilities`, no shipped manifest advertises the name, so **every existing A2 sourcing claim would stop resolving** on the already-shipped who-decides page (#2353/#2354). It also edits `fulfillment-authority` next door to #2391. If it is ever wanted it is its own issue with its own migration question, not a line in a registry PR.

`FulfillmentRouter` is re-admitted by whichever wave takes A2 off `config-only`. This plan is its sole record until then, alongside the amended #2403.

### A fourth mirror exists and the issue does not name it
`docs/plugin-author-guide.md` reproduces the array **verbatim** inside a fenced block, and `scripts/check-plugin-guide-quotes.mjs` compares it **line by line** against a pinned source range (`sourceStart: 23`, `sourceEnd: 52`, `guideLinkSubstring: 'adapter.types.ts:23-52'`), which also appears as link text in the guide. Adding two commented entries lengthens the declaration, so **four values must move together**: the two script constants, the guide's link text, and the guide's fenced body.

This is a good failure mode — the check fails loudly on a length mismatch, so it cannot drift silently. It is called out so it is not discovered as a surprise `pnpm lint` red, and so it is not left red for the next person.

### A fifth mirror (gate finding W1), folded into this PR
`AuthorityKindDescriptor.capability` is typed **bare `string`** (`authority-kind.types.ts:77`), and `check-authority-kind-mirror.mjs` pins those strings only against the `docs/` table — never against `CoreCapabilityValues`. Today that is defensible because the names are not well-known. **After this change they are**, and a typo (`'AvailabiltyAuthority'`) would type-check, pass both mirror scripts, and silently disable the A1 gate — the exact silent-degradation shape #2351 shipped its script to close.

It ships as a **spec**, not as an edit to `check-authority-kind-mirror.mjs`, which REVIEW H8a assigns to #2311.

### `returns-authority-dispatch.spec.ts` names this issue and is unaffected
Its header says it is "a spec that BREAKS when a later wave (`W3a-14`) wires dispatch" for `ReturnsAuthority`. `W3a-14` is this issue, and this issue does **not** wire `ReturnsAuthority` dispatch — it adds two unrelated names. The spec keeps passing. **Assumption**: the forward reference is approximate and its comment is left untouched; correcting it would edit a file whose subject is another wave's decision. Flagged rather than silently rewritten.

### Are the two new values advertised-without-dispatch?
**No.** Both are dispatch names by construction: each is already the registry key `AUTHORITY_KIND_DESCRIPTORS` names as the gate for its authority (A1 `availability`, A3 `fulfillment-execution`), and each is the key a caller will pass to `getCapabilityAdapter(connectionId, 'X')` once its port and adapter exist. Advertised-without-dispatch is the opposite posture — a name in a manifest that must only ever be reached by narrowing a dispatched adapter with an `is*` guard. Nothing here routes either through a guard, and nothing adds either to any manifest.

### Assumption: no operator can assign these today, and that is correct for this slice
`ConnectionService` validates a written `enabledCapabilities` name against the resolved adapter's `supportedCapabilities`, and no shipped manifest advertises either. So the names round-trip through the closed union (making them writable in principle, per #2351's reasoning about `@IsIn`) while remaining unassignable in practice until an adapter declares one. This is the same reachability posture `ReturnsAuthority` has today, recorded in `architecture-overview.md` § Capability Abstractions.

### The #2085 stamped-`enabledCapabilities` trap does not fire here
`enabledCapabilities` is stamped at connection-create and never retro-filled, so *gating live behaviour* on a new name drains nothing for existing connections. This change gates nothing: it adds vocabulary, and no code path reads either name at runtime. Should a later wave gate on one, the migration/backfill question is that wave's and must be raised then.

### Documentation gap
`architecture-overview.md` § Capability Abstractions describes the closed set in prose but states no total, so no stale count needs updating there. Every count this plan or the PR states is scoped **"after this change"** rather than "now".

---

## 6. Proposed Implementation Plan

### Phase 1 — Core (the authoritative declaration)

1. **Add the two members to `CoreCapabilityValues`**
   - **File**: `libs/core/src/integrations/domain/types/adapter.types.ts`
   - **Action**: append `'AvailabilityAuthority'` and `'FulfillmentExecutor'` after `'ReturnsAuthority'`, each with a comment naming its ADR-052 authority row, its `AUTHORITY_KIND_DESCRIPTORS` gate, and the issue. Record the `FulfillmentRouter` deferral in the declaration's **JSDoc**, not inside the array literal — a note below the last member reads as if it describes whichever value is appended next, and the array body is reproduced verbatim in the plugin-author guide, where a deferral rationale is noise. Cite the `ModifiedProductLister` (#2220) precedent. Appending (rather than inserting) keeps every mirror's diff to an append too.
   - **Acceptance**: `CoreCapabilityValues.length === 12`.

2. **Update the exact-array spec**
   - **File**: `libs/core/src/integrations/domain/types/__tests__/adapter.types.spec.ts`
   - **Action**: extend the `toEqual([...])` literal with the two values and their provenance comments.
   - **Acceptance**: fails if a value is added, removed or reordered without editing it.

3. **Add the `MasterReservationWriter` absence spec** (gate finding W2)
   - **File**: `libs/core/src/integrations/domain/types/__tests__/master-reservation-writer-absence.spec.ts` (new)
   - **Action**: assert the name is absent from (i) `CoreCapabilityValues` and (ii) every **imported** adapter manifest's `supportedCapabilities` — importing the manifest constants as values (`allegroAdapterManifest`, `prestashopAdapterManifest`, `erliAdapterManifest`, …), **never** a filesystem string scan. Carry a **positive control**: a fabricated manifest the assertion is proven to reject, so a broken predicate cannot pass vacuously. Header points at #2315 and ADR-061, and names `libs/core/src/inventory/domain/ports/inventory-master.port.ts` as the **one legitimate mention** so a later reader does not "tighten" this into a string scan.
   - **Why not a string scan**: the literal already appears in prose at `inventory-master.port.ts:166` and `:189` — the ADR-061 docblock that *records* the deferral. A naive scan is red on day one and gets "fixed" by weakening, which is how a mirror becomes a no-op.

4. **Add the descriptor-capability pin** (gate finding W1)
   - **File**: `libs/core/src/integrations/domain/types/__tests__/authority-kind-capability-pin.spec.ts` (new)
   - **Action**: for every `AUTHORITY_KIND_DESCRIPTORS` entry whose `capability !== 'config-only'`, assert the value is a member of `CoreCapabilityValues`. Carry a positive control proving the predicate rejects a typo'd name.
   - **Cross-context note**: a spec may import two contexts; this adds no runtime edge and no `check-cross-context-imports` violation (verify).
   - **Acceptance**: green now; red on a deliberate `'AvailabiltyAuthority'` typo.

### Phase 2 — Frontend mirrors

5. **Mirror 1 — `CORE_CAPABILITY_VALUES`**
   - **File**: `apps/web/src/features/connections/api/connections.types.ts`
   - **Action**: append the same two values, same order, with abbreviated comments in the FE house style already used there.

6. **Mirror 2 — `CAPABILITY_HELP`**
   - **File**: `apps/web/src/features/connections/lib/capability-metadata.ts`
   - **Action**: one operator-facing sentence per new value, in array order, saying what the connection *decides* (matching its ADR-052 authority). The record is typed `Record<CoreCapability, string>`, so a missing key is a type error **once mirror 1 carries the member** — which is why both must land together.

### Phase 3 — Documentation mirrors

7. **Mirror 3 — the fenced capability table** (`docs/capabilities.md`, between `<!-- core-capabilities:start -->` and `:end`): two rows in array order, first cell a backticked identifier.

8. **Mirror 4 — the plugin-author guide verbatim quote** (`docs/plugin-author-guide.md`, `scripts/check-plugin-guide-quotes.mjs`): replace the fenced block verbatim; update the link text `adapter.types.ts:23-52` → the new range; update `sourceStart` / `sourceEnd` / `guideLinkSubstring`. The range is **read off the file after step 1**, never guessed.

### Phase 4 — Red-first verification (the point of the exercise)

9. **Prove each mirror fails, in both directions, for the right reason**
   - For each mirror: apply a temporary drift, run the specific check, capture exit code **and the first stderr line**, revert. Two directions each:
     - *core-has / mirror-lacks*: delete one new value from the mirror.
     - *mirror-has / core-lacks*: add a fabricated `'FabricatedCapability'` to the mirror.
   - Plus an **order** drift on the three `check-core-capability-mirror.mjs` mirrors, whose rule includes order.
   - Plus W1 red-first: a typo'd descriptor capability. Plus W2 red-first: the name added to a manifest fixture.
   - **Beware a red for the wrong reason.** A failing check must **name the drifted value** in its output. A red that is a parse failure, a `TS6133`, or `Tests: 0 total` is **not** evidence (#2390's first attempt) — record the message, not just the code.
   - **Re-verify the script's own guards after the edit** rather than carrying the pre-change reading forward: `check-core-capability-mirror.mjs --self-check` still exits 0 (it exercises drifted fixtures including a **renamed declaration**, which must be fatal not vacuous); all four locate-failures still `push(fatal)` → `exit(1)`; both parsers still match whole tokens (quoted literals; `` /^`[A-Za-z][A-Za-z0-9]*`$/ ``) with no substring `includes` on an identifier.
   - **Artifact**: a red-first evidence table in the PR body — mirror × direction × exit code × first stderr line.

### Phase 5 — Quality gate

10. `pnpm lint` (includes `check:invariants`, expected **35** steps after #2390), `pnpm type-check`, `pnpm test`, then **separately** `pnpm test:integration`. Never unit and integration concurrently. Node 22.

### Implementation details

**New components**: three spec files. Nothing else is created.
**Configuration changes**: none. **Migrations**: none. **Events**: none. **Error handling**: none — no runtime path is added.

---

## 7. Alternatives Considered

### Alternative 1: ship all three values as the issue's AC says (10 → 13)
- **Why rejected**: `FulfillmentRouter` gates nothing and can gate nothing while A2 is `'config-only'`. Landing it makes the array's own stated entry rule untrue of one of its members and invites a later gate that silently does nothing (#2085 / #2220). See §5.

### Alternative 2: land the values together with their ports (fold #2391 in)
- **Why rejected**: `libs/core/src/fulfillment/**` is owned by a concurrent sibling agent (#2391). Two agents editing one directory produces a merge conflict at best and a silently-lost interface at worst. The value and the interface are genuinely separable, so splitting costs nothing.
- **Trade-off**: the tree carries two capability names with no port for the duration of the wave — the same state `ReturnsAuthority` has been in since #2351, explicitly by design.

### Alternative 3: a new mirror script per new capability
- **Why rejected**: two guards on one fact can disagree — the rule `check-core-capability-mirror.mjs`'s own header states about `docs/plugin-author-guide.md`. The existing script is data-driven over the array and needs **no edit at all** to cover two more values.

### Alternative 4: insert the values beside semantically related neighbours rather than appending
- **Why rejected**: order is part of the mirror contract, so an insertion forces a reordering diff in four places and makes every red-first drift harder to attribute. Semantic grouping is served by the per-entry comments, as `Invoicing` / `Fiscalization` / `ReturnsAuthority` already read.

---

## 8. Validation & Risks

### Architecture compliance
- ✅ No CORE ↔ Integration boundary crossed. CORE publishes vocabulary; integrations declare support.
- ✅ `as const` + derived union, per `engineering-standards.md § Union Types`.
- ✅ Types stay in a `*.types.ts` file. No new `any`, no `console.log`, no framework import in the domain layer.

### Risks

| Risk | Mitigation |
|---|---|
| **Mirror 4 forgotten** — the verbatim quote and its three pinned line-range spots | `check-plugin-guide-quotes.mjs` fails loudly on a length mismatch and runs under `check:invariants`. Named as an explicit plan step, not left to discovery. |
| **W2 spec red on day one** — the ADR-061 docblock legitimately names the string | Predicate is manifest-and-array membership, never a string scan. Comment names the port file as the one legitimate mention. |
| **A stale total in prose** — three stale counts were found during Wave 2 integration, each correct when written | Every count is scoped *"12 after this change"*, never *"12 today"*. `architecture-overview.md` states no total. |
| **Red-for-the-wrong-reason** — #2390's first attempt went red on `TS6133` with `Tests: 0 total` | Record the first stderr line per drift, not the exit code alone. A red that does not name the drifted value is discarded and retried. |
| **A silently no-op mirror** — the #2673 shape (renamed declaration reads as "pending" not "broken") | All four locate-failures are fatal and `--self-check` exercises a renamed declaration. **Re-verified after the change**, not assumed. |
| **Routing a name through the registry before its port exists** | Nothing here calls `getCapabilityAdapter` / `listCapabilityAdapters`. If a later wave does so early, `dispatchCapability` throws a generic `Error` and, in the list path, aborts the whole listing. Recorded so the next wave knows. |
| **Integration-suite ripple** — a manifest capability change ripples into routing int-specs | No manifest changes, so the ripple should be nil. Full integration suite run anyway. |
| **Concurrent sibling agents** | File list is disjoint from #2391's (`libs/core/src/fulfillment/**`, `check-no-injection-contracts.mjs`) and #2404's (shared port-contract test kit). W1 ships as a spec in `integrations/`, so `check-authority-kind-mirror.mjs` (#2311) is untouched. |

### Edge cases
- **A plugin already registering one of these strings out of tree**: harmless. `supportedCapabilities` is `string[]` and open (#576); the name simply becomes a well-known one.
- **An existing connection carrying one of the names in `enabledCapabilities`**: impossible today — `ConnectionService` validates against the adapter's advertised list and nothing advertises them.

### Backward compatibility
✅ Additive. The union widens, so every existing narrowing still compiles; no member removed or renamed; no persisted value changes meaning. `@IsIn(CoreCapabilityValues)` on both connection DTOs widens its accepted set.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit tests
- `adapter.types.spec.ts` — updated exact-array assertion (order-sensitive).
- `master-reservation-writer-absence.spec.ts` — new; positive control + array/manifest membership.
- `authority-kind-capability-pin.spec.ts` — new; positive control + every non-`config-only` descriptor capability is a registry member.

### Integration tests
None added. The full suite is **run** because a capability-vocabulary change historically ripples into routing int-specs (`docs/lessons.md`).

### Invariant checks (the real test surface)
- `check-core-capability-mirror.mjs` — three mirrors, membership **and** order, both directions, plus `--self-check`.
- `check-plugin-guide-quotes.mjs` — mirror 4, line-by-line.
- `pnpm check:invariants` — expected 35 steps.

### Acceptance criteria
- [ ] `CoreCapabilityValues` holds **12** members; the two new ones are `AvailabilityAuthority` and `FulfillmentExecutor`.
- [ ] `FulfillmentRouter` is a member of **no** capability list (core array, FE union, docs table, plugin-guide quote) and is resolved by no call site; it appears only in comments recording its deferral, plus this plan.
- [ ] Exact-array spec updated and order-sensitive.
- [ ] `MasterReservationWriter` asserted absent from every manifest and every capability list, by membership not string scan, with a header pointing at #2315.
- [ ] Every non-`config-only` `AUTHORITY_KIND_DESCRIPTORS` capability is pinned to a registry member.
- [ ] `CAPABILITY_HELP` exhaustive — a missing string is a type error.
- [ ] All four mirrors + both new specs fail on a deliberate drift in **both** directions, with the failure naming the drifted value; evidence recorded per mirror per direction.
- [ ] `docs/capabilities.md` fenced table and the plugin-guide quote updated.
- [ ] `pnpm lint` / `pnpm type-check` / `pnpm test` / `pnpm test:integration` all pass (known pre-existing: #2638 `earliest-order-date`, #2639 `allegro-prestashop-carrier-mapping`).
- [ ] No file under `libs/core/src/fulfillment/`, `scripts/check-no-injection-contracts.mjs`, `scripts/check-authority-kind-mirror.mjs`, or the shared port-contract test kit is touched.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — domain types only, no layer crossed
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns — #2351's shape verbatim; no new abstraction, no new script
- [x] Idempotency / events / rate limits — N/A, no runtime path
- [x] Error handling — N/A; the one throw-adjacent hazard (dispatch with no port) is documented in §8
- [x] Testing strategy complete — unit + four invariant checks + red-first evidence per direction
- [x] Naming conventions followed; file structure matches standards
- [x] Plan is execution-ready and saved as a markdown file

---

## Related Documentation

- [Architecture Overview § Capability Abstractions](../architecture-overview.md#capability-abstractions-business-roles)
- [Engineering Standards § Union Types](../engineering-standards.md#union-types-as-const-pattern-default)
- [`docs/capabilities.md`](../capabilities.md)
- ADR-052 (independently assignable fulfilment authorities), ADR-053, ADR-054, ADR-055, ADR-061 (`MasterReservationWriter` deferral), ADR-062
