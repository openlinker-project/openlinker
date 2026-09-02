# Implementation Plan: Shared port-contract test kit (#2404, `W3a-15`)

**Date**: 2026-08-30
**Status**: rev 4 — the executor suite is IN scope; #2398 merged into `oms-programme-wave-3a` (tip `c7ee984f1`), so rev 3's stated reason for excluding it has expired
**Estimated Effort**: ~1 day
**Branch**: `2404-port-contract-test-kit` (worktree), PR into `oms-programme-wave-3a`

> **Revision note (rev 4).** Rev 3 excluded `FulfillmentExecutorPort` on the explicit
> ground that **#2398 was in flight, not merged**, and recorded in §10 the assumption
> that it would not land before this PR. It landed. The exclusion was conditional on a
> fact that is no longer true, so the condition is discharged rather than re-argued:
> the kit now covers **both** merged ports. Rev 3's §10 hedge ("a suite reviewed for one
> port should not silently grow a second") is answered by the executor suite being a
> SEPARATE file with its own case tables, fixtures and specs, reviewed on its own terms —
> not a widening of the router suite. `AvailabilityAuthority` stays out for its own,
> undischarged reason: it has no dispatched adapter anywhere in the tree.
>
> What rev 4 adds beyond the second suite: the `./fulfillment/testing` package-exports
> entry and the `check:invariants` registration (both specified in rev 3's Phase 2/3 and
> **not** actually done — the run script failed on the missing subpath, which is how the
> gap was found), plus the two documentation steps.
>
> **The executor suite carries one design problem the router suite did not have**:
> `FulfillmentStatusSource` is OPTIONAL, and the obvious handling of an optional
> capability is `it.skip` — which is precisely the vacuity this issue exists to prevent,
> since a skipped case reads green while asserting nothing, making a BROKEN status read
> indistinguishable from an absent one. Applicability is therefore structural (the status
> cases enter the declared table only when the guard narrows the subject), decided by ONE
> function both the checker and the jest wrapper call, and asserted in BOTH directions.
>
> **Red-first evidence (rev 4).** Four mutations, each reverted:
> `M1c` a declared case with no fixture -> coverage spec fails naming the id;
> `M2b` status cases run for a non-status subject -> 6 assertion failures;
> `M3b` the subject guard made unreachable -> the "throws, not skips" test fails;
> `M4` a case that asserts nothing -> 4 assertion failures on `checks > 0`.
> Three earlier attempts (`M1b`/`M2`/`M3`) were discarded as evidence because they failed
> to COMPILE and reported `Tests: 0 total` — a false pass, not a red.

> **Revision note.** Rev 1 placed the kit in `libs/test-kit` and argued the issue's own
> target was wrong. `/pre-implement` found that argument rested on a false premise — this
> repo already ships two parameterized contract suites in exactly the conventional place —
> and that the transitive-dependency cost runs the *opposite* way to what rev 1 recorded.
> **Rev 3 reverses the placement back to the issue's target.** The reversal is kept visible
> rather than edited out; the analysis doc holds the evidence.

---

## 1. Task Summary

**Objective**: ship a shared, parameterized **port-contract suite** — one suite every implementation of an OMS fulfilment port must pass — wired against the one port that exists today, `FulfillmentRouterPort` (#2393, merged).

**Context**: design §9 asks for contract symmetry enforced by a shared suite, so the seam gets *two-implementer honesty before a second implementer exists*.

**Classification**: DX / Testing (CORE, `fulfillment`).

---

## 2. Scope & Non-Goals

### In scope

- A contract suite covering `FulfillmentRouterPort` — the ONE port merged and available.
- A **hard-failure** design for four vacuity modes (no subject; empty suite; a case that never ran; **a case with no mutation fixture**), proved by tests of the suite itself, verified red-first.
- Self-tests: a conforming fake passes; one non-conforming fake per case fails **its own** case and no other.

### Out of scope (reasons, not omissions)

- `runFulfillmentExecutorContract` — `FulfillmentExecutorPort` / `FulfillmentStatusSource` are **#2398**, in flight, not merged. **No stub is shipped**: a declared-but-empty suite is green forever and its presence is a standing claim of coverage — the precise vacuity failure this issue exists to prevent.
- `runAvailabilityAuthorityContract` — `AvailabilityAuthority` is declared in ADR-061 with **no dispatched adapter anywhere in the tree**; `AvailabilityService` always answers `provenance: 'computed'`. There is nothing to hold to a contract.
- AC-1's "consumed by `W3a-17` and `W3a-18`" — **#2408 / #2409 have not merged.** The suite is built so those consumers are a one-line call; this plan does not claim they pass.
- Consuming the `pending` `RoutingPlan` arm (`W4-3`).

---

## 3. Placement — the issue's target is correct

The suite goes in **`libs/core/src/fulfillment/testing/fulfillment-router-contract.suite.ts`**, reached through a new `@openlinker/core/fulfillment/testing` package-exports subpath.

**(a) It is the established convention, with two shipped precedents.** `libs/integrations/ksef/src/testing/ksef-client-contract.suite.ts` exports `runKsefHttpClientContract` (30 jest-global call sites); `libs/integrations/subiekt/src/testing/subiekt-bridge-contract.suite.ts` exports `runSubiektBridgeContractTests` (22) and runs against **two implementations today** — the fake and the real `SubiektBridgeHttpClient`. That is design §9's "one suite, two implementers", already working. Rev 1 claimed no `/testing` sub-barrel names `describe`/`it`/`expect`; that was simply false, and the objection built on it is withdrawn.

**(b) The dependency cost runs the other way.** `libs/core/src/fulfillment/index.ts` re-exports `FulfillmentModule`, which imports `@nestjs/typeorm`, and the ORM entities pull `reflect-metadata`. A `libs/test-kit` placement value-importing `@openlinker/core/fulfillment` therefore drags both — **neither declared in `libs/test-kit/package.json`**, so both would resolve only through `shamefully-hoist`, exactly the fragility `engineering-standards.md § Workspace dependency declarations` warns about and invisible to `check-workspace-dep-declarations.mjs` (it audits `@openlinker/*` only). A suite **inside** `fulfillment/testing/` imports relatively (`../domain/types/routing.types`), never transits the barrel, and incurs none of it: **no new package dependency, no tsconfig reference, no build-wiring change.**

**(c) It is the better-enforced home.** `check-cross-context-imports.mjs` walks `libs/core/src`; it does **not** walk `libs/test-kit` at all. The in-context placement is subject to a gate the alternative would escape.

**(d) The one real cost, stated.** Jest globals sit on a subpath of a package every host and plugin production-depends on. This is mitigated the way ksef and subiekt already mitigate it — a dedicated `./testing` subpath that the **main barrel does not re-export** — and that non-re-export is asserted by the AC-3 guard (Phase 4) rather than left to reviewer vigilance.

**(e) The forward-growth objection dissolves.** Rev 1 worried a leaf could not host suites for `AvailabilityAuthority` (in `inventory`) or the executor. The precedent answers it: **each package owns the suite for its own port** — ksef's lives in ksef, subiekt's in subiekt. "One kit" in §9 means one consistently-shaped suite per port, not one file.

**What this costs the plan**: `route/holds-carry-known-reason` is dropped. It needs `HoldReasonValues` as a **value** from `@openlinker/core/order-lifecycle`, and `barrel-purity.spec.ts` authorises that leaf's cross-context specifiers as **type-only**. See §5.

---

## 4. The failure mode this is designed against

A contract suite is exactly the machinery that can look thorough and assert nothing. This repo has shipped both halves:

- **#2673** — a mirror keyed on a declaration name that was renamed and moved; "not found" and "pending" were indistinguishable, so it reported green over a live divergence for months.
- **#2589** — `css.includes('.' + name)`, which passes on any prefixed class.
- **#2393** — a compile-time key guard **vacuous by construction**: `keyof (A | B)` is the *intersection*, so a bare `Extract<>` over a discriminated union reads `never` and is green forever.

Four states are made impossible. The table states what each guard does **and does not** catch — a guard oversold is the same defect one level up.

| Vacuity mode | Guard | Catches / does not catch |
|---|---|---|
| **No subject** — no factory, or one producing no router | `checkFulfillmentRouterContract` **throws** `ContractSubjectMissingError` before any case runs. Never `it.skip`, never an early `return`. | Structural. Complete. |
| **Empty suite** — the case table has zero entries | Throws `EmptyContractSuiteError`. | Structural. Complete. |
| **A case that never ran** — early `return`, swallowed throw | The wrapper asserts reported ids === `FULFILLMENT_ROUTER_CONTRACT_CASE_IDS`, and each case reports `checks > 0`. | Catches non-execution. **Does NOT catch a case that ran and asserted nothing** — `checks` is self-reported, so `checks++` with no comparison passes. Cheap secondary. |
| **A case that asserts nothing, or is untested** | **PRIMARY: mutation coverage.** Every case has ≥1 non-conforming fixture that must fail *that* case and no other, plus a declared-vs-covered equality test asserting the fixture table targets exactly the declared id set. | The real guard. Without the equality test a new case id could ship with `checks++`, no fixture, and a green suite — the #2673 shape exactly. |

### The structural move, and why it is an advance on the precedent

```
checkFulfillmentRouterContract(router) : Promise<ContractRunResult>   // PURE — no jest globals
runFulfillmentRouterContract(makeRouter)                             // thin jest wrapper (ksef/subiekt shape)
```

Both shipped suites are jest-coupled throughout, so **neither can answer "did this actually assert anything?" from outside jest** — the question this issue is about. Splitting the rules into a pure function that returns per-case `{ id, checks, failures[] }` is the smallest change that makes the question answerable. Naming follows two existing repo conventions: `check*` for a pure non-narrowing rule (`checkRequiredToSell`, `checkRoutingPlanConservesQuantities`), `run*Contract` for the jest entry point (ksef, subiekt).

Consequences, each a requirement rather than a nicety:

1. **AC-2 becomes an ordinary unit test** — `expect(result.failures).toContain(...)` against a hand-broken router. No nested jest, no `jest.spyOn(global, 'it')`.
2. **Red-first is cheap and honest**, so a red for the *wrong* reason (`TS6133` with `Tests: 0 total`; a container that refused to boot) is visible.
3. **A plugin author not on jest can call the pure half directly.**

---

## 5. What the contract asserts

Every rule cites the declaration in `libs/core` that supports it. **A rule with no source is not shipped** — that is the #2240 "mirror stricter than the gate" failure.

| Case id | Rule | Source |
|---|---|---|
| `route/requires-idempotency-key` | `route()` accepts a `RouteOptions.idempotencyKey`; the same key applied twice yields an **equivalent plan body** (assignments / unfulfillable / holds compared structurally). | port docblock: the key is REQUIRED and derived from the persisted routing-decision row |
| `route/conserves-quantities` | A `resolved` plan satisfies `checkRoutingPlanConservesQuantities`. | `routing.types.ts` — "a plan that silently drops a line is unfulfilled stock with every surface reporting success" |
| `route/unfulfillable-resolution-closed` | Every `unfulfillable.resolution` ∈ `RoutingUnfulfillableResolutionValues`. | closed two-member union, DESIGN §5.3(a) |
| `route/explanation-steps-well-formed` | **Every step present** carries non-empty `rule.ruleId` / `rule.name` / `rule.displayLabel`. No minimum count. | `RoutingExplanationStep` field types |
| `route/plan-status-recognised` | The router's `status` is a value this build can read (`resolved` acted on; `pending` refused; anything else raises `UnrecognisedRoutingPlanStatusError`). | `pending-routing-plan-not-supported.error.ts` |
| `evaluate/no-committing-identifier` | `RoutingEvaluation` carries no `decisionId` and no `holds` key. | port §(b) — the ABSENCE is the contract |
| `evaluate/candidates-name-known-lines` | Every `candidates[].orderLineId` and `unfulfillable[].orderLineId` appears in `input.lines`. | the `evaluate` half of the "must not invent a line" property `checkRoutingPlanConservesQuantities` gives `route`; `RoutingEvaluation` has no conservation helper |
| `evaluate/does-not-mutate-input` | `evaluate()` leaves the caller's `RoutingInput` deep-equal to what was passed. | every `RoutingInput` field is `readonly`; `lines` is `readonly RoutingInputLine[]` |
| `input/unknown-fields-ignored` | A router handed a `RoutingInput` carrying an extra undeclared field still answers rather than throwing. | ADR-055 forward-compat |

### Rules deliberately NOT asserted, and why

- **`decisionId` stability across a repeated idempotency key.** The issue asks for "idempotency-key survival across retry" and rev 1 asserted identical `decisionId`s. **The port does not declare that** — its docblock states the key's *provenance and ordering*, not a return-value guarantee — so a stateless router, which the port permits and the suite hands no store, would fail a rule the contract never imposed. Narrowed to plan-body equivalence, which a deterministic router satisfies without persistence. Tightening it needs a port amendment; that is #2398's wave.
- **`holds[].reason ∈ HoldReasonValues`.** Buildable only with a **value** import of `@openlinker/core/order-lifecycle`, which `barrel-purity.spec.ts` forbids from this leaf (its authorised specifiers are type-only). Dropped rather than smuggled. `RoutingHold.reason` is typed `HoldReason`, so this is compile-time-enforced for any TypeScript implementer, and holds remain covered for **quantity** by `route/conserves-quantities`.
- **`blocking` exclusion.** Named in the issue; `FulfillmentRouterPort` has no `blocking` concept. Asserting one would be a mirror stricter than the gate.
- **Declared-timeout respect.** The port defers wall-clock budgets to `W4-1`/`W4-2`. There is no declared timeout, and a wall-clock assertion would be a flaky test measuring nothing.
- **`ROUTING_INPUT_FORBIDDEN_KEYS` tolerance.** Near-tautological — every other case already passes a forbidden-key-free input — and it points the wrong way: that constant constrains **what core sends**, so the useful assertion belongs on the caller (#2395).
- **`unfulfillable.quantity` positivity.** A plain `number` with no declared bound; asserting positivity is kit-imposed hygiene dressed as a contract.
- **`assertRoutingPlanResolved`'s own behaviour.** Already owned by `pending-routing-plan-not-supported.error.spec.ts` (6 `it` blocks). The suite asserts only the router-facing half.

---

## 6. Implementation plan

### Phase 1 — the pure runner (no jest globals)

1. **`.../testing/contract-result.types.ts`** — `ContractCaseResult { id; checks; failures[] }`, `ContractRunResult`, `ContractSubjectMissingError`, `EmptyContractSuiteError`.
2. **`.../testing/fulfillment-router-contract.suite.ts`** — `FULFILLMENT_ROUTER_CONTRACT_CASE_IDS` + `checkFulfillmentRouterContract`. Throws on the two structural faults; a case that throws is recorded as a **named** failure, never swallowed. Imports only relative same-context paths.

### Phase 2 — the jest wrapper

3. Same file (ksef/subiekt keep runner and suite together) — `runFulfillmentRouterContract(makeRouter)`: `beforeAll` runs the check once; one `it` per declared case id; one meta-`it` on reported-vs-declared ids.
4. **`.../testing/index.ts`** + `libs/core/package.json` `"./fulfillment/testing"` exports entry (the `./events/testing` shape). **The main `./fulfillment` barrel does not re-export it.**

### Phase 3 — self-tests, red-first

5. **`.../testing/__tests__/fixtures/`** — a conforming router plus one non-conforming fixture **per declared case**, each keyed by the case id it targets.
6. **`fulfillment-router-contract.spec.ts`** — the conforming router passes all cases; **each** fixture fails **its own** case and no other.
7. **`contract-coverage.spec.ts`** — **the primary anti-vacuity guard**: the fixture table's targeted ids === `FULFILLMENT_ROUTER_CONTRACT_CASE_IDS`, failing on either side, so a case shipped without a fixture is a build failure. Also asserts the declared count is non-zero.
8. **`contract-vacuity.spec.ts`** — no subject throws; an empty case table throws; a zero-`checks` case is surfaced as a failure. **Written and verified red before the guards exist.**
9. **`scripts/check-contract-suite-not-in-production.mjs`** + one line in `check:invariants`, with `--self-check` (27 of 35 scripts follow that convention). Asserts three structural facts, none by naive substring: the `./fulfillment/testing` subpath exists; the main `./fulfillment` barrel does **not** re-export the suite; no non-spec file imports it. This is AC-3.

### Phase 4 — docs

10. `docs/architecture-overview.md` § Fulfillment — the suite, what it covers, what it declares out of scope, and the two dropped rules with their reasons.
11. `docs/testing-guide.md` — a "Port-contract suites" subsection naming all three (ksef, subiekt, fulfillment-router) so the convention is discoverable in one place.

---

## 7. Alternatives considered

**A. `libs/test-kit/src/contracts/`** — rev 1's choice, now rejected: it contradicts two shipped precedents, drags two undeclared packages via the barrel's `FulfillmentModule` re-export, and escapes `check-cross-context-imports` entirely.

**B. A jest-only suite matching ksef/subiekt exactly** — rejected: AC-2 would need nested jest or global spying, and "does it actually assert?" would be unanswerable from inside jest. The pure split is the point of this issue.

**C. Stub the two unmerged suites** — rejected, load-bearing: a suite with no rules is green forever, and its presence in the barrel is a standing claim the port is covered.

---

## 8. Validation & risks

- **Architecture** ✅ — same-context relative imports only; no CORE↔Integration crossing; no new sibling-context edge, so `barrel-purity.spec.ts`'s allow-set is untouched.
- **Naming** ✅ — `*-contract.suite.ts` + `run*Contract` match ksef/subiekt; `check*` matches the pure-rule convention. No new suffix is invented, so no `engineering-standards.md` edit is needed.
- **Risk — jest globals on core's surface** — mitigated by the dedicated subpath and asserted by the Phase 3 step 9 guard.
- **Risk — a rule stricter than the port** — the source column plus seven explicit non-assertions; three over-reaches found by review are removed or softened.
- **Risk — the suite rots when #2398 lands** — named: the executor suite is a new file beside this one, not a refactor.
- **`libs/core/dist` is absent in this worktree** — a cold `pnpm -r build` is mandatory before the gate, not precautionary.

---

## 9. Testing strategy & acceptance

- **Unit** — `libs/core/src/fulfillment/testing/__tests__/*.spec.ts`. No Docker; the subject is an in-memory fake.
- **Integration** — none added. The suite asserts a port contract, not a wiring.
- **Gates** — `pnpm lint` (incl. `check:invariants`, **35** scripts today → **36** after Phase 3 step 9), `pnpm type-check`, `pnpm test`, `pnpm test:integration`, run sequentially. Never unit concurrent with integration.

Acceptance:

- [ ] A conforming fake router passes every declared case with `checks > 0`.
- [ ] Each non-conforming fixture fails its own named case and no other — verified red first.
- [ ] **The fixture table's targeted ids equal the declared case id set**, failing on either side.
- [ ] A subject-less run and an empty case table each **throw**; neither skips.
- [ ] The main `./fulfillment` barrel does not re-export the suite, asserted by script.
- [ ] `check-contract-suite-not-in-production.mjs` passes and fails under `--self-check`.
- [ ] Coverage stated honestly: `FulfillmentRouterPort` covered; executor and availability out of scope with reasons; two rules dropped with reasons.

---

## 10. Questions & assumptions

- **Assumption**: #2398 will not merge into `oms-programme-wave-3a` before this PR. If it does mid-flight, the executor suite is a follow-up — a suite reviewed for one port should not silently grow a second.
- **Open**: whether ksef and subiekt should later adopt the pure-runner split so they can self-test too. Out of scope here; worth an issue once this shape has proven itself on one port.
