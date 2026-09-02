# Pre-Implement Readiness Gate — #2391 `fulfillment` context (`W3a-2`)

**Date**: 2026-08-30 · **Branch**: `2391-fulfillment-context` (base `origin/oms-programme-wave-3a`)
**Plan**: `docs/plans/implementation-plan-fulfillment-context.md`
**Mode**: READ-ONLY. Nothing was implemented; this file is the only write.

## Verdict: **GO WITH CHANGES**

No reuse collision and no contract-surface break blocks the slice. Every registration
point the plan names exists and is shaped as described, and the plan's counts (35
invariant scripts, section `### 26`, alphabetical `CONTEXT_BARRELS` slot) check out.
Three defects need fixing before implementation: the Phase-3 boot test as specified is
**unwritable and cannot be seen red** (R2), the `fulfillment.tokens.ts` decision (F3)
contradicts a shipped standard whose exemption text this plan proposes to amend in the
wrong direction (R3), and the `check-no-injection-contracts.mjs` docblock is now stale
against the working-tree edit already applied (R1).

---

## Evidence

### 1. Reuse collisions — none in code

`FulfillmentWorkStatusValues`, `FulfillmentRequestStatusValues`, `FulfillmentWorkActionValues`,
`FulfillmentWorkLine`, `FulfillmentWorkRef` — **zero hits** anywhere in `libs/`, `apps/`,
`scripts/` (including `libs/oms` and `apps/web`). The bare token `FulfillmentWork` appears only
in prose/comments and one guard list:

- `libs/core/src/fulfillment-authority/domain/types/authority-scope.types.ts:42` — JSDoc.
- `libs/core/src/fulfillment-authority/domain/types/authority-kind.types.ts:45` — JSDoc.
- `libs/core/src/orders/domain/ports/order-hold-repository.port.ts:18` — JSDoc.
- `apps/web/src/features/orders/lib/order-lifecycle-phase.ts:18` — JSDoc (the P9 ban).
- `scripts/check-ui-vocabulary.mjs:121` — `{ term: 'FulfillmentWork', mode: 'exact', alternates: ['fulfillment work'] }`.

**P9 scope confirmed safe**: `check-ui-vocabulary.mjs` `SCAN_ROOTS` (`:151-186`) are four
`apps/web/src/features/*` directories under `SCAN_ROOT_PARENT = apps/web/src/features` (`:192`).
Core JSDoc naming `FulfillmentWork` cannot trip it. Docs hits (ADR-054, DESIGN/REVIEW, specs)
are prose only.

### 2. Existing vocabulary — single-declared, as F1/F2 claim

- `FulfillmentCancellationReasonValues` — declared **once**, at
  `libs/core/src/fulfillment-authority/domain/types/fulfillment-cancellation-reason.types.ts:27`
  (type alias `:65`, guard `:73`), plus its own spec. No second declaration, no FE mirror.
- `HoldReasonValues` / `HoldReason` — declared once in core at
  `libs/core/src/order-lifecycle/domain/types/hold-reason.types.ts:47` / `:58`. There **is** a
  deliberate FE mirror at `apps/web/src/features/orders/lib/order-hold.types.ts:29/:40`, pinned by
  `scripts/check-hold-reason-mirror.mjs:72`. Neither is a redeclaration this slice must worry
  about; F2's "no import needed" holds.

### 3. `barrel-purity.spec.ts` (347 lines)

`CONTEXT_BARRELS` (`:31-54`):
```
'ai','automation','catalog-trust','content','customers','events','fulfillment-authority',
'identifier-mapping','integrations','inventory','listings','mappings','order-lifecycle',
'orders','products','returns','sales-documents','sync','users','webhooks'
```
Alphabetical slot for `'fulfillment'` is **after `'events'` (:36) and before `'fulfillment-authority'` (:37)** — the plan is right.

`ZERO_SIBLING_EDGE_LEAVES` (`:154-158`):
```ts
const ZERO_SIBLING_EDGE_LEAVES = [
  { context: 'sales-documents', authorizedTypeOnlySpecifiers: ['@openlinker/core/orders/types'] },
  { context: 'fulfillment-authority', authorizedTypeOnlySpecifiers: [] },
  { context: 'order-lifecycle', authorizedTypeOnlySpecifiers: ['@openlinker/core/orders/types'] },
] as const;
```

Non-empty-directory assertion (`:174-176`):
```ts
// An empty walk must FAIL, not vacuously pass — a renamed or moved
// directory would otherwise silently retire the leaf's guarantee.
expect(files.length).toBeGreaterThan(0);
```
Confirms the plan's phase ordering risk (files before registration). Note the walk **excludes
`*.spec.ts`** (`:169`), so co-located specs do not satisfy it — at least one non-spec `.ts` must exist.

Type-only classification — the matcher (`:78-86`) plus its docblock (`:72-76`):
```ts
const findModuleSpecifierStatements = (withoutComments) =>
  [...withoutComments.matchAll(/(?:import|export)\s+(type\s+)?[^'";]*?from\s+['"]([^'"]+)['"]/g)]
    .map(([, typeOnly, specifier]) => [typeOnly, specifier]);
```
> "Note the INLINE type form — `import { type OrderStatus } from '…'` — is classified as a VALUE
> import and therefore fails… write `import type { … }`." (`:72-76`)

So `import type { FulfillmentCancellationReason } from '@openlinker/core/fulfillment-authority'`
passes; `import { type … }` fails. **However — see R4**: the docblock at `:150-153` states the
authorized specifier is *"a `…/types` cycle-breaker sub-barrel — never a main
`@openlinker/core/<ctx>` barrel"*. F1's proposed allow-set entry is a **main barrel**, the first
such entry in the table.

Two further assertions that constrain this slice:
- `:282-287` — no `ZERO_SIBLING_EDGE_LEAVES` member may appear as `'./<ctx>'` in `libs/core/src/index.ts`.
- `:87-95` — every `CONTEXT_BARRELS` member must `require()` cleanly **and export at least one key**
  (`expect(Object.keys(mod).length).toBeGreaterThan(0)`), so the barrel cannot be types-only-at-runtime.
  A leaf of pure `interface`/`type` exports with no `as const` value would fail; the three `*Values`
  arrays and the guards satisfy it.

### 4. `libs/core/package.json`

`exports` block; leaf entries sit together at `:67-80`:
```json
"./fulfillment-authority": { "types": "./dist/fulfillment-authority/index.d.ts", "require": "...", "default": "..." },
"./sales-documents":       { ... },
"./order-lifecycle":       { ... }
```
`"./fulfillment"` goes beside them. **No `typesVersions` key exists** (grep: NONE) — nothing else to add.
`tsconfig.base.json:33` maps `"@openlinker/core/*": ["libs/core/src/*"]` and
`apps/worker/test/jest-integration.cjs:30` maps `'^@openlinker/core/(.*)$'` — both wildcards, so
**no tsconfig / jest-mapper edit is required** and `check-jest-integration-mappers.mjs` will not fire.

### 5. `libs/core/src/index.ts`

Docblock `:1-19`, the relevant sentence:
> "A **zero-sibling-edge leaf** — `sales-documents` (#2100), `fulfillment-authority` (#2304) and
> `order-lifecycle` (#2305), whose whole value is that siblings can value-import them without
> closing a CJS module-load cycle — therefore stays OFF this barrel…"

`export *` list is `:20-33` (14 contexts); **no leaf is re-exported**. Confirmed.

### 6. Pre-existing references to the new path/specifier

No stale code reference to `@openlinker/core/fulfillment` exists. `libs/core/src/fulfillment/`
is referenced by:
- `scripts/check-no-injection-contracts.mjs:17,21` (header), `:112` (`WATCHED_CONTEXTS`),
  `:135-143` (the `NO_INJECTION_CONTRACTS` entry — **already present as an uncommitted
  working-tree edit**, `git status`: `M scripts/check-no-injection-contracts.mjs`),
  and `:337-386` (self-check fixtures).
- Docs only: `docs/plans/implementation-plan-libs-oms-package-scaffold.md:105`,
  `docs/plans/analysis/ANALYSIS-2390-libs-oms-package-scaffold.md:132`,
  `docs/plans/analysis/DESIGN-oms-authority-model.md:213`, and this plan.

### 7. `apps/worker/test/integration/invoicing-auto-issue-boot.int-spec.ts` (83 lines)

Structure: a docblock; imports `getTestHarness` / `teardownTestHarness` / `WorkerIntegrationTestHarness`
from `./setup` (`:15-16`), five DI tokens/classes from `@openlinker/core/{orders,invoicing,inventory}`
and `../../src/sync/handlers/*`. `beforeAll` calls `getTestHarness()` — which boots Testcontainers
Postgres + Redis and the real worker `AppModule` (`apps/worker/test/integration/setup.ts:22,199`);
`afterAll` calls `teardownTestHarness()`. Five `it()` blocks, **all positive resolutions**:
`harness.get(InvoicingIssueHandler)` (`:40`), `harness.get(ORDER_INGESTION_SERVICE_TOKEN)` +
`AUTO_ISSUE_TRIGGER_SERVICE_TOKEN` (`:48-55`), `INVOICE_SERVICE_TOKEN` (`:63`),
`RESERVATION_SERVICE_TOKEN` (`:78`), and a registry membership check (`:83-86`). Runtime is
container-boot dominated (~1 Testcontainers Postgres + Redis start, tens of seconds).

**What a copy would need to change — and why the plan's version cannot be written as specified**:
this spec proves an invariant by **resolving something**. The #2391 leaf ships *no module, no
provider, no token* (`fulfillment.tokens.ts` is empty by F3), so it is not in the container's
module graph at all and `harness.get(...)` has nothing to ask for. "Assert nothing reachable from
the fulfillment barrel resolves an orders/inventory service" is vacuously true against an empty
graph, and the plan's own red-first recipe ("temporarily inject an `orders` service into a
provider under `libs/core/src/fulfillment/`") requires inventing a provider that this slice does
not ship — which is the same false-pass shape #2390's R10 attempt hit. See **R2**.

CI note (correcting the plan's §6 caveat in the operator's favour): the root script is
`"test:integration": "pnpm --filter @openlinker/api test:integration"` (`package.json:25`), so a
worker spec is **not** run locally by `pnpm test:integration` — but `.github/workflows/ci.yml:322`
runs `pnpm --filter @openlinker/worker test:integration`, so it **is** covered in CI.

### 8. `pnpm check:invariants`

61 `&&`-chained invocations resolving to **35 distinct scripts** (24 of them run twice, once with
`--self-check`). The plan's "expected count 35" is correct **as a count of distinct scripts**;
state that qualifier, since a naive `&&` count reads 61. Chain head/tail:
`check-fixture-purity.sh → … → check-no-injection-contracts (13,14) → … → check-ui-vocabulary (60,61)`.
`check-architecture-gates.mjs` counts config knobs (threshold 7, `:222`) and ladder rungs
(threshold 3, `:247`) — this slice adds neither and will not trip it.

### 9. ESLint

No rule fires on creating `libs/core/src/<ctx>` or on the specifier `@openlinker/core/fulfillment`.
The three relevant `no-restricted-imports` blocks (`.eslintrc.js:770-778` port/capability files,
`:805-812` integration packages, `:835-841` host apps) ban only **deep sub-paths**
(`/domain/**`, `/application/**`, `/infrastructure/**`, `/orm-entities`, `/*.tokens`). A top-level
barrel import is exactly what they require. `check-cross-context-imports.mjs` will also pass: its
`DENY_PATTERNS` (`:589-594`) are `RepositoryPort$|OrmEntity$|Adapter$|Dto$`, and unmatched names
are **default-allowed** (`classifyName`, `:662-670`), so `FulfillmentCancellationReason` is fine.

---

## Required changes to the plan

1. **§6 Phase 3 / §9 — rewrite the boot test, or defer it to #2392.** As specified it cannot be
   written honestly: the leaf contributes no provider or token to the container, so
   `harness.get(...)` has nothing to resolve and "nothing resolves an orders/inventory service" is
   vacuously true. Evidence: the precedent spec proves its invariant by **positive resolution** at
   `apps/worker/test/integration/invoicing-auto-issue-boot.int-spec.ts:40,48-55,63,78`, and the
   plan's own red-first recipe (`…-fulfillment-context.md:260-262`) requires inventing a provider
   under `libs/core/src/fulfillment/` that §2 In-scope does not ship. Pick one and say so in the
   plan: **(a)** defer the boot spec to #2392, when `FULFILLMENT_WORK_REPOSITORY_TOKEN` and a real
   module exist to resolve — the source-text guard
   (`scripts/check-no-injection-contracts.mjs:134-143`) plus the barrel-purity leaf assertion
   (`barrel-purity.spec.ts:174-231`) are the whole coverage this slice can honestly carry; or
   **(b)** replace it with a **container-free** spec that `require()`s the built barrel and asserts
   its transitive `require` graph touches no `orders`/`inventory` module — which is what the
   invariant actually is at this grain. Update the §8 risk table and the AC checkbox accordingly.

2. **§6 Phase 1 item 5 / F3 / §6 Phase 2 item 12 — do not ship an empty `fulfillment.tokens.ts`,
   and do not amend the standard to carve it out.** `docs/engineering-standards.md:818` says in
   terms that for a concern with no binding "an empty `<ctx>.tokens.ts` would be ceremony and
   `export *` from it would widen the barrel with nothing", and `:820` fixes the expiry rule:
   "the exemption expires **the day the concern needs a binding**" — which is #2392, not #2391.
   Both shipped leaves are named as holders at `:822` and neither carries the file
   (`libs/core/src/fulfillment-authority/index.ts:64-73` has no tokens re-export). Plan step 12
   proposes editing that paragraph to name `fulfillment` as *not* holding the exemption, which
   writes a per-issue exception into a general standard. **Change step 12 to the opposite edit**:
   add `fulfillment` to the "Two concerns hold it today" list at `:822` (making it three), and
   drop Phase 1 item 5. If `/tech-review` insists on honouring the AC literally, record the
   deviation in the PR body as F3 already anticipates — but the plan should not carry the doc
   amendment as its default.

3. **§6 Phase 2 item 9 — the contract entry is applied but its own docblock is now false.**
   `scripts/check-no-injection-contracts.mjs:113-116` still reads *"`libs/core/src/fulfillment` is
   watched from #2390 and **does not exist yet**"* and `:115-117` *"**EMPTY TODAY, on purpose**:
   the only watched context does not exist yet (#2391 creates it)"*, while `:134-143` already
   holds the contract in the working tree (`git status`: `M scripts/check-no-injection-contracts.mjs`).
   Add an explicit plan step to update both docblocks in the same commit that creates the
   directory, and note that the working-tree edit is currently **uncommitted** so it must not be
   lost by a `reset`/`stash`.

4. **F1 / §6 Phase 2 item 7 — the proposed allow-set entry is the first MAIN-barrel carve-out and
   the spec's own docblock argues against it.** `barrel-purity.spec.ts:150-153`:
   *"In every case the authorized specifier is a `…/types` cycle-breaker sub-barrel — never a main
   `@openlinker/core/<ctx>` barrel, which re-exports the context's NestJS module and would
   reintroduce exactly the cycle risk this table exists to avoid…"*. F1 proposes
   `authorizedTypeOnlySpecifiers: ['@openlinker/core/fulfillment-authority']`, a main barrel. The
   import is still safe — that barrel exports **no module** (`fulfillment-authority/index.ts:64-73`
   is ten type files, and the leaf itself has an empty allow-set at `:156`) — but the plan must say
   so and must **amend the docblock's absolute claim** in the same edit, or it leaves a comment
   that now contradicts the table beneath it. State the narrowing explicitly: *a main barrel is
   authorized only when the target is itself a registered zero-sibling-edge leaf that exports no
   NestJS module.*

5. **§6 Phase 1 — at least one non-spec `.ts` must land before registration, and the barrel must
   export a runtime value.** Two assertions, both easy to trip: the leaf walk excludes `*.spec.ts`
   (`barrel-purity.spec.ts:169`) before `expect(files.length).toBeGreaterThan(0)` (`:176`), and the
   `CONTEXT_BARRELS` require-check asserts `Object.keys(mod).length > 0` (`:91`) — so a barrel of
   pure `interface`/`type` exports fails. The three `*Values` arrays and the `is*` guards satisfy
   the second; make both constraints explicit in the risk table (today it names only the first).

6. **§9 — qualify the invariant count.** `pnpm check:invariants` is **61 chained invocations
   resolving to 35 distinct scripts** (`package.json:29`); 24 scripts run twice (`--self-check`
   then live). Write "35 distinct scripts / 61 invocations" so a reader verifying the number does
   not conclude the plan is stale.

7. **§6 Phase 3 placement caveat — correct it.** The plan states a worker int-spec "is not
   executed by `pnpm test:integration`", which is true of the **root script only**
   (`package.json:25` filters to `@openlinker/api`). `.github/workflows/ci.yml:322` runs
   `pnpm --filter @openlinker/worker test:integration`, so CI does cover it. Restate as "not run by
   the root local script; run explicitly, and covered in CI at ci.yml:322" — the current wording
   understates the coverage and could justify skipping a spec that CI would have run.

8. **§6 Phase 2 item 11 — the section number and slot are confirmed; pin them.**
   `docs/architecture-overview.md` context sections end at `### 25. Operational Settings` (`:515`),
   so `### 26. Fulfillment` is correct. The leaf-count prose to update is
   `docs/engineering-standards.md:822` ("Two concerns hold it today") and
   `libs/core/src/index.ts:9-11` (which names the three leaves by issue number) — the plan's step 10
   says "docblock prose names the fourth leaf" but does not name `engineering-standards.md:822` as a
   *count* edit; list both file:line targets so neither is missed.

### Non-blocking observations

- `CONTEXT_BARRELS` is **not** an inventory of contexts (`currency`, `invoicing`, `shipping`,
  `fiscalization`, `analytics-trust` are absent). Adding `'fulfillment'` is therefore a deliberate
  opt-in, not a completeness fix — no other context needs touching.
- F5 verified: `libs/oms` is not a `WATCHED_CONTEXTS` member
  (`check-no-injection-contracts.mjs:112` lists exactly one directory) and the script header
  `:76-84` records why it must not become one.
