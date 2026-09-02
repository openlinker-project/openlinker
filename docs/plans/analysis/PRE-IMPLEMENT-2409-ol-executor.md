# Pre-implement gate: #2409 — OL executor (`W3a-18`)

**Date**: 2026-08-31
**Plan**: `docs/plans/implementation-plan-2409-ol-executor.md`
**Verdict**: **READY** — with one Warning-class correction to Phase 4 (below), which the plan named
against the wrong guard script. No Critical findings; no reuse collision.

---

## Reuse audit

| Plan artifact | Classification | Evidence |
|---|---|---|
| `OlFulfillmentExecutor` (`FulfillmentExecutorPort` impl) | **NEW — confirmed absent** | Repo-wide, the only non-core reference to `FulfillmentExecutorPort` is a `type` import in `apps/worker/src/sync/handlers/fulfillment-work-dispatch.handler.ts:50`. No class anywhere `implements FulfillmentExecutorPort`. This is genuinely the first implementer. |
| `FulfillmentExecutorPort` | **EXISTS → implement** | `libs/core/src/fulfillment/domain/ports/fulfillment-executor.port.ts` |
| `FulfillmentStatusSource` | **EXISTS → deliberately declined** | `.../ports/capabilities/fulfillment-status-source.capability.ts`. Plan D2. |
| Contract suite | **EXISTS → consume** | `@openlinker/core/fulfillment/testing` is a published subpath (`libs/core/package.json` exports `./fulfillment/testing`), and `libs/oms/jest.config.mjs` maps `^@openlinker/core/(.*)$` → `../core/src/$1`, so it resolves in the oms jest realm without new wiring. |
| `FulfillmentExecutor` capability name | **EXISTS in `CoreCapabilityValues`, NOT in any manifest** | `libs/core/src/integrations/domain/types/adapter.types.ts`. Advertising it is additive. |
| DI token / repository / ORM entity | **None required** | Plan D1 leaves the executor stateless. Nothing is added to `fulfillment.tokens.ts`; no `*.orm-entity.ts`; **no migration** — which sidesteps the colliding-tail hazard entirely. |
| `OmsPluginDeps` | **EXISTS → left untouched** | `libs/oms/src/oms.plugin.ts`. Plan D7: `createOmsPlugin(deps?)` keeps its optional signature and `OmsModule` stays on `createNestAdapterModule`. |

---

## Backward-compatibility findings

### Critical
None. Nothing is removed or renamed: no barrel export, no port signature, no DTO field, no Symbol token,
no ORM column. Every change is additive (one manifest array member, one dispatch-table key, one class).

### Warning 1 — the plan names the WRONG guard for the `adapter.types.ts` lockstep

The plan's Phase 4 says the `adapter.types.ts` ↔ `docs/plugin-author-guide.md` pair is compared by
`scripts/check-core-capability-mirror.mjs`. **It is not.** That script's own docblock explicitly disclaims
it: *"NOT checked here: `docs/plugin-author-guide.md`, whose verbatim quote of the same array is already
owned by `check-plugin-guide-quotes.mjs`. One fact, one guard."* It compares three other mirrors — the FE
union, `CAPABILITY_HELP`, and the fenced table in `docs/capabilities.md`.

The real guard is **`scripts/check-plugin-guide-quotes.mjs`**, and it is stricter in a way that matters:

- It quotes `libs/core/src/integrations/domain/types/adapter.types.ts` **lines 38–77 verbatim** into a fence
  in the guide, and the `FulfillmentExecutor` comment block sits inside that range.
- It additionally asserts the guide carries a link line containing the literal substring
  `adapter.types.ts:38-77` (`guideLinkSubstring`).

**Consequence for implementation**: the comment edit must be **line-count-neutral**. Rewriting
`// … Same posture as A1 above.` in place is fine; adding or removing a line inside 38–77 shifts the range
and then requires a four-file lockstep — the source, the guide's fence, the guide's link line, *and* the
script's own `guideLinkSubstring` constant. Keep the edit to same-line rewrites, or accept the four-file
change deliberately.

Note also that `docs/capabilities.md`'s fenced core-capabilities table **is** checked by
`check-core-capability-mirror.mjs`, but only on array membership — which this change does not alter — so it
needs no edit.

### Warning 2 — `check:invariants` rules this change touches (none tripped, all verified applicable)

- `check-outbound-http.mjs` — `libs/oms` is in `SCAN_ROOTS` (line 68). The stateless executor imports
  nothing; passes trivially. This is the plan's "no HTTP client in the dependency graph" acceptance criterion,
  and it is **already enforced**, so no new assertion is needed for it.
- `check-no-injection-contracts.mjs` — `libs/oms` is deliberately **not** a subject, and the script's
  docblock warns at two separate places against "fixing" that. The plan does not register it. Correct.
- `check-cross-context-imports.mjs` — the plan imports no `*RepositoryPort`; D1/D2 are what keep this true.
- `check-workspace-dep-declarations.mjs` — `libs/oms` already declares `@openlinker/core`. No manifest edit.
- `check-contract-suite-not-in-production.mjs` — the suite is imported only from a `*.spec.ts`. Correct.

### Warning 3 — `pnpm type-check` covers the new spec, so `libs/core` must be built

`libs/oms/tsconfig.json` has `include: ["src/**/*"]`, so the new `*.spec.ts` is type-checked by
`tsc --noEmit`. It imports `@openlinker/core/fulfillment/testing`, which resolves for **types** through the
package `exports` map to `dist/`. A stale or absent `libs/core/dist` will therefore surface as a
type-check failure that looks like a plan defect and is not one — rebuild libs first
(`pnpm -r --filter "./libs/**" build`).

---

## Open questions (do not block implementation)

1. **The `acceptedAt` claim-guard thinning (plan D3).** Writing `acceptedAt = null` makes the second conjunct
   of `recordAcceptance`'s guard (`AND "acceptedAt" IS NULL`) non-narrowing for OL-executed work. The plan
   correctly reports this rather than hiding it, and correctly declines to widen a core guard on an adapter's
   behalf. Confirmed not a live defect: `recordAcceptance` is the only writer of `requestStatus = 'accepted'`
   in the tree. Leave as a reported follow-up.
2. **Boundary with #2408.** Both issues edit `libs/oms/src/oms.plugin.ts` (`supportedCapabilities` + dispatch
   table) and `libs/oms/src/index.ts`. The plan flags resolution-by-intent. Nothing further to gate here, but
   the merge must not be taken textually.

---

## Verdict

**READY.** The plan's central design decisions (D1 statelessness, D2 declining `FulfillmentStatusSource`,
D3 `acceptedAt: null`) are each confirmed against the live tree, and the statelessness decision removes the
migration, the TypeORM dependency and the ADR-051 role-provider cost that #2405 had predicted this issue would
pay. Apply Warning 1's correction — the lockstep guard is `check-plugin-guide-quotes.mjs`, and the
`adapter.types.ts` edit should be line-count-neutral — before touching Phase 4.
