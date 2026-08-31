# ANALYSIS — #2404 shared port-contract test kit (`W3a-15`)

**Gate**: `/pre-implement` (read-only) · **Plan**: `docs/plans/implementation-plan-port-contract-test-kit.md`
**Base**: `origin/oms-programme-wave-3a` @ `939d407b7` · **Date**: 2026-08-30

## Verdict on plan rev 1: NEEDS-REVISION → applied in rev 3

No contract-surface break; the change is purely additive. The gate found one decisive
precedent collision that reversed the plan's placement decision, plus five smaller
corrections. All are applied in rev 3 of the plan.

## R1 (BLOCKING, applied) — two parameterized contract suites already exist

Plan rev 1 §3(a) asserted that no `/testing` sub-barrel names `describe`/`it`/`expect`.
**False.** Verified in the tree:

| Suite | Exported runner | jest-global call sites | Backends today |
|---|---|---|---|
| `libs/integrations/ksef/src/testing/ksef-client-contract.suite.ts` | `runKsefHttpClientContract(makeClient, opts)` | 30 | fake |
| `libs/integrations/subiekt/src/testing/subiekt-bridge-contract.suite.ts` | `runSubiektBridgeContractTests(makeClient)` | 22 | **two** — fake + real `SubiektBridgeHttpClient` |

Subiekt is design §9's "one suite, two implementers", already shipped and consumed from
two spec files. The established convention is therefore
`<pkg>/src/testing/*-contract.suite.ts` exporting `run*Contract(makeSubject)`, reached
through a dedicated `./testing` package-exports subpath that the main barrel does not
re-export. The issue's literal target is the CONVENTIONAL location, not an oversight.

## R4 (BLOCKING, applied) — the transitive-dependency cost runs the other way

`libs/core/src/fulfillment/index.ts` re-exports `FulfillmentModule`, which imports
`@nestjs/typeorm`; the ORM entities pull `reflect-metadata`. A `libs/test-kit`
value-import of `@openlinker/core/fulfillment` therefore drags both, and **neither is
declared in `libs/test-kit/package.json`** — they would resolve only through
`shamefully-hoist`, precisely the fragility `engineering-standards.md § Workspace
dependency declarations` warns about, and invisible to
`check-workspace-dep-declarations.mjs` (it audits `@openlinker/*` only).

A suite living inside `fulfillment/testing/` imports **relatively**
(`../domain/types/routing.types`), never transits the barrel, and incurs none of this.
Recorded in rev 1 as a neutral cost; it is in fact an argument against the test-kit
placement and for the in-context one.

## R5 (applied) — `HoldReasonValues` cannot be value-imported from the leaf

`barrel-purity.spec.ts` authorises `@openlinker/core/fulfillment-authority` for the
`fulfillment` leaf as `authorizedTypeOnlySpecifiers` — type-only. `HoldReasonValues` is a
runtime array, so `route/holds-carry-known-reason` is not buildable in-context and is
dropped from the case table, with the reason stated in the plan rather than silently
omitted. `RoutingHold.reason` remains compile-time-enforced for any TypeScript
implementer, and holds stay covered for quantity by `checkRoutingPlanConservesQuantities`.

## R2 (applied) — naming

No `*.contract.ts`, `contracts/` directory or `describe*Contract` symbol exists anywhere.
Rev 3 adopts the shipped convention instead of inventing a third spelling:
`fulfillment-router-contract.suite.ts`, exporting `runFulfillmentRouterContract`. The pure
half takes the repo's `check*` prefix for a non-narrowing pure rule
(`checkRequiredToSell`, `checkRoutingPlanConservesQuantities`).

## R3 (applied) — frame the split as an advance on the precedent

Both shipped suites are jest-coupled throughout, so neither can answer "did this assert
anything?" from outside jest. Rev 3 states the pure-runner split as the improvement it is,
rather than as a greenfield invention.

## R6 (applied) — the AC-3 guard must not false-positive

A naive substring scan hits docblock prose. Rev 3's guard asserts three structural facts
instead: the `./fulfillment/testing` subpath exists in `libs/core/package.json`; the main
`./fulfillment` barrel does **not** re-export the suite (this is what keeps jest globals
off the production surface); and no non-spec file imports the suite. `--self-check` per the
convention 27 of 35 invariant scripts already follow.

## Cleared, not blocking

- `libs/core/package.json` exports `./fulfillment`, and every planned symbol is
  barrel-reachable — verified individually.
- No port, DTO, token or ORM change; **no migration**.
- `libs/core` declares no dependency on test-kit, so no cycle either way.
- `check-cross-context-imports.mjs` walks `libs/core/src`, so the in-context placement IS
  walked — a stricter, better-enforced home than test-kit, which is not walked at all.
- `libs/core/dist` is absent in this worktree: the cold `pnpm -r build` is mandatory.

## Unchanged and correct

Shipping ONE real subject rather than three names. #2398 (executor) has not merged;
`AvailabilityAuthority` has no dispatched adapter anywhere in the tree.
